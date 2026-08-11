import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

/** A message the application wants delivered to a person. */
export interface OutboundEmail {
  to: string;
  subject: string;
  /** Plain-text body. Kept plain so the console transport stays readable. */
  body: string;
}

/**
 * Email delivery, with two transports.
 *
 * `console` (the default) writes messages to the log and sends nothing, which
 * keeps the project self-contained: a reviewer can complete an invitation or a
 * password reset end to end without an SMTP account.
 *
 * `smtp` sends for real via nodemailer, and works with any provider that
 * speaks SMTP — Postmark, SES, Resend, Mailgun, or a plain mailbox. SMTP was
 * chosen over a vendor SDK deliberately: it is one dependency instead of one
 * per provider, and switching provider becomes a change of environment
 * variables rather than a change of code.
 *
 * Delivery failures are logged and swallowed. An invitation row that exists
 * without a delivered email can be resent; an invitation rolled back because
 * the mail server hiccuped is lost work.
 */
@Injectable()
export class MailerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    if (this.transport !== 'smtp') {
      this.logger.log(
        'Mail transport is "console" — messages are logged, not sent',
      );
      return;
    }

    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT') ?? 587;
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASSWORD');

    if (!host) {
      // Fail loudly at boot rather than silently at the first invitation.
      throw new Error('MAIL_TRANSPORT=smtp requires SMTP_HOST to be set');
    }

    this.transporter = createTransport({
      host,
      port,
      // Implicit TLS on 465; STARTTLS on everything else.
      secure: port === 465,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });

    this.logger.log(`Mail transport is "smtp" via ${host}:${port}`);
  }

  onModuleDestroy(): void {
    this.transporter?.close();
  }

  /**
   * Sends an email, or logs it when no provider is configured.
   *
   * @param email - Recipient, subject and body.
   */
  async send(email: OutboundEmail): Promise<void> {
    try {
      await this.deliver(email);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to deliver "${email.subject}" to ${email.to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Verifies the configured transport can actually connect.
   *
   * Exposed so a deployment can check its mail configuration without sending a
   * message to a real person.
   *
   * @returns Whether the transport is reachable.
   */
  async verify(): Promise<boolean> {
    if (!this.transporter) return true;

    try {
      await this.transporter.verify();
      return true;
    } catch (error: unknown) {
      this.logger.warn(
        `SMTP verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private get transport(): string {
    return this.configService.get<string>('MAIL_TRANSPORT') ?? 'console';
  }

  private async deliver(email: OutboundEmail): Promise<void> {
    if (this.transporter) {
      await this.transporter.sendMail({
        from:
          this.configService.get<string>('MAIL_FROM') ??
          'Warehouse OS <no-reply@example.com>',
        to: email.to,
        subject: email.subject,
        text: email.body,
      });
      this.logger.log(`Sent "${email.subject}" to ${email.to}`);
      return;
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
  }
}
