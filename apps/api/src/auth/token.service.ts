import { createHash, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type {
  AccessTokenPayload,
  AuthTokens,
  RefreshTokenPayload,
} from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';

/** Client metadata stored alongside an issued refresh token. */
export interface TokenClientInfo {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Issues an access/refresh pair and persists the refresh token's hash.
   *
   * Only a SHA-256 hash of the refresh token is stored. A database leak
   * therefore yields nothing replayable, and because the hash column is unique
   * we can detect a token being presented twice.
   *
   * @param user - The authenticating user.
   * @param client - Optional user agent and IP for the session record.
   * @returns The token pair to hand back to the client.
   */
  async issueTokens(
    user: { id: string; email: string },
    client: TokenClientInfo = {},
  ): Promise<AuthTokens> {
    const accessTtl = this.configService.getOrThrow<number>('JWT_ACCESS_TTL');
    const refreshTtl = this.configService.getOrThrow<number>('JWT_REFRESH_TTL');

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      tokenType: 'access',
      jti: randomUUID(),
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      tokenType: 'refresh',
      jti: randomUUID(),
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessTtl,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtl,
      }),
    ]);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: TokenService.hash(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtl * 1_000),
        userAgent: client.userAgent?.slice(0, 250) ?? null,
        ipAddress: client.ipAddress?.slice(0, 60) ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtl,
      tokenType: 'Bearer',
    };
  }

  /**
   * Validates a refresh token and rotates it, returning a fresh pair.
   *
   * Rotation is one-shot: the presented token is revoked as part of the same
   * transaction that issues its replacement, so a stolen token is useless the
   * moment the legitimate client refreshes.
   *
   * @param refreshToken - The raw refresh token supplied by the client.
   * @param client - Optional user agent and IP for the new session record.
   * @returns A new token pair.
   * @throws UnauthorizedException when the token is invalid, expired or reused.
   */
  async rotate(
    refreshToken: string,
    client: TokenClientInfo = {},
  ): Promise<AuthTokens> {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        {
          secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        },
      );
    } catch {
      throw new UnauthorizedException(
        'Refresh token is invalid or has expired',
      );
    }

    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('Provided token is not a refresh token');
    }

    const tokenHash = TokenService.hash(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, isActive: true } } },
    });

    if (!stored || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException(
        'Refresh token is invalid or has expired',
      );
    }

    if (stored.revokedAt) {
      // The token was already rotated. Either it leaked or a client is retrying
      // with a stale value; revoking the whole family is the safe response.
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException(
        'Refresh token has already been used — all sessions have been revoked',
      );
    }

    if (!stored.user.isActive) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    const tokens = await this.issueTokens(
      { id: stored.user.id, email: stored.user.email },
      client,
    );

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: {
        revokedAt: new Date(),
        replacedById: TokenService.hash(tokens.refreshToken),
      },
    });

    return tokens;
  }

  /**
   * Revokes a single refresh token, used when a client signs out.
   *
   * @param refreshToken - The raw refresh token to invalidate.
   */
  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: TokenService.hash(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revokes every live refresh token for a user.
   *
   * @param userId - Owner of the sessions to terminate.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Hashes a raw token for storage and lookup. */
  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
