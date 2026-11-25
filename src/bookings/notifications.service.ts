import { Injectable, Logger } from '@nestjs/common';

export interface OutgoingMessage {
  to: string;
  subject: string;
  body: string;
}

// Stub: only logs. Swap the body of send() for a real provider (SMTP, Resend, SES) later;
// callers do not need to change.
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  send(message: OutgoingMessage): void {
    this.logger.log(`[email stub] to=${message.to} subject="${message.subject}"`);
  }
}
