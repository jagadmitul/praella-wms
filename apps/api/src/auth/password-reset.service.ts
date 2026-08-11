import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../notifications/mailer.service';
import { TokenService } from './token.service';
import { AuthService } from './auth.service';

/**
 * Password reset.
 *
 * Two properties matter here and both are easy to get wrong:
 *
 * 1. **No account enumeration.** Requesting a reset always returns 204,
 *    whether or not the address exists. An endpoint that 404s on unknown
 *    emails is a free membership oracle.
 *
 * 2. **Resetting terminates every session.** A user resetting their password
 *    is often doing so *because* they think someone else has access, so every
 *    refresh token for that account is revoked on success. Leaving old sessions
 *    alive would defeat the point of the reset.
 */
@Injectable()
export class PasswordResetService {
  private static readonly TTL_MINUTES = 30;
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly mailer: MailerService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Issues a reset link, if the address belongs to an active account.
   *
   * Always resolves without indicating whether it did.
   *
   * @param email - Address the reset was requested for.
   */
  async request(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, fullName: true, isActive: true },
    });

    if (!user || !user.isActive) {
      this.logger.log(
        `Password reset requested for unknown address ${email} — ignored`,
      );
      return;
    }

    // Any earlier link becomes useless the moment a new one is issued.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(32).toString('hex');

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: PasswordResetService.hash(token),
        expiresAt: new Date(
          Date.now() + PasswordResetService.TTL_MINUTES * 60 * 1_000,
        ),
      },
    });

    const base = (
      this.configService.get<string>('APP_URL') ?? 'http://localhost:3300'
    ).replace(/\/$/, '');

    await this.mailer.send({
      to: email,
      subject: 'Reset your password',
      body: [
        `Hello ${user.fullName},`,
        '',
        'Use the link below to choose a new password:',
        `${base}/reset-password/${token}`,
        '',
        `This link expires in ${PasswordResetService.TTL_MINUTES} minutes and can be used once.`,
        '',
        'If you did not request this, you can safely ignore it — nothing has changed.',
      ].join('\n'),
    });
  }

  /**
   * Consumes a reset token and sets the new password.
   *
   * @param token - Raw token from the reset link.
   * @param password - The new password.
   * @throws BadRequestException when the token is unknown, used or expired.
   */
  async confirm(token: string, password: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: PasswordResetService.hash(token) },
      select: { id: true, userId: true, usedAt: true, expiresAt: true },
    });

    const invalid = new BadRequestException(
      'This reset link is invalid, has expired, or has already been used',
    );

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw invalid;
    }

    const passwordHash = await AuthService.hashPassword(password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    await this.tokenService.revokeAllForUser(record.userId);
  }

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
