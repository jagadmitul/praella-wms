import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** A message the application wants delivered to a person. */
export interface OutboundEmail {
  to: string;
  subject: string;
  /** Plain-text body. Kept plain so the console transport stays readable. */
  body: string;
}

/**
 * Email delivery.
 *
 * The default transport writes to the log rather than sending anything, which
 * keeps the project self-contained: a reviewer can complete an invitation or a
 * password reset end to end without configuring an SMTP provider or an API key.
 *
 * The seam is deliberate — swapping in Postmark, SES or Resend means
 * implementing `deliver` and nothing else. Every caller already treats sending
 * as fallible and never lets a delivery failure roll back the business
 * operation that triggered it.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Sends an email, or logs it when no provider is configured.
   *
   * @param email - Recipient, subject and body.
   */
  async send(email: OutboundEmail): Promise<void> {
    try {
      await this.deliver(email);
    } catch (error: unknown) {
      // Never fail the caller: an invitation row that exists without a
      // delivered email can be resent, whereas a rolled-back invitation
      // because the mail server hiccuped is just lost work.
      this.logger.error(
        `Failed to deliver "${email.subject}" to ${email.to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Transport implementation. Replace this to send real mail. */
  private async deliver(email: OutboundEmail): Promise<void> {
    const transport = this.configService.get<string>('MAIL_TRANSPORT') ?? 'console';

    if (transport !== 'console') {
      throw new Error(`Unknown MAIL_TRANSPORT "${transport}"`);
    }

    this.logger.log(
      [
        '',
        '──────────────── OUTBOUND EMAIL (console transport) ────────────────',
        `To:      ${email.to}`,
        `Subject: ${email.subject}`,
        '',
        email.body,
        '────────────────────────────────────────────────────────────────────',
      ].join('\n'),
    );

    return Promise.resolve();
  }
}
