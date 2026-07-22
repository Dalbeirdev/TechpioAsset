import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfig } from '../../config/config.module.js';
import { MailProvider, type MailMessage, type MailResult } from './mail.provider.js';

/** Real SMTP delivery. Selected with MAIL_PROVIDER=smtp. */
@Injectable()
export class SmtpMailProvider extends MailProvider {
  readonly name = 'smtp';
  private readonly logger = new Logger(SmtpMailProvider.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: AppConfig) {
    super();
    this.from = config.get('MAIL_FROM');

    const user = config.get('SMTP_USER');
    const pass = config.get('SMTP_PASSWORD');

    this.transporter = createTransport({
      host: config.get('SMTP_HOST'),
      port: config.get('SMTP_PORT') ?? 587,
      secure: config.get('SMTP_SECURE'),
      // Mailpit and similar catchers accept anonymous connections; passing empty
      // credentials would make them reject the session.
      ...(user ? { auth: { user, pass } } : {}),
    });
  }

  async send(message: MailMessage): Promise<MailResult> {
    const info = await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });

    this.logger.log(`Sent email to ${message.to} — "${message.subject}"`);
    return { messageId: info.messageId, simulated: false };
  }
}
