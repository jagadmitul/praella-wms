import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';

/** Outbound notifications. Global so any feature can send without re-importing. */
@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class NotificationsModule {}
