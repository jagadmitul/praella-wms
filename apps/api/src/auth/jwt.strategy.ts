import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AccessTokenPayload } from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/types/request-context';

/**
 * Validates the bearer access token on every protected request.
 *
 * The user is re-read from the database rather than trusted wholesale from the
 * token claims, so deactivating an account takes effect on the next request
 * instead of whenever the current access token happens to expire.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * Turns a verified token payload into the request principal.
   *
   * @param payload - The decoded and signature-verified access token.
   * @returns The authenticated user attached to `request.user`.
   * @throws UnauthorizedException when the token is the wrong type or the user
   *   no longer exists or has been deactivated.
   */
  async validate(payload: AccessTokenPayload): Promise<RequestUser> {
    if (payload.tokenType !== 'access') {
      throw new UnauthorizedException('Provided token is not an access token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, fullName: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account no longer exists or has been deactivated');
    }

    return { id: user.id, email: user.email, fullName: user.fullName };
  }
}
