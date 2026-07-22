import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { AppConfig } from '../../config/config.module.js';
import { MailProvider, type MailMessage, type MailResult } from './mail.provider.js';

/**
 * Writes each message as an RFC 5322 .eml file under .local-mail.
 *
 * Chosen over "log the subject and move on" because a password-reset link that
 * is never rendered cannot be tested. The file opens in any mail client, so the
 * flow is verifiable end to end without an SMTP server.
 */
@Injectable()
export class LocalMailProvider extends MailProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalMailProvider.name);
  private readonly directory: string;
  private readonly from: string;

  constructor(config: AppConfig) {
    super();
    this.directory = path.resolve(process.cwd(), '../../.local-mail');
    this.from = config.get('MAIL_FROM');
  }

  async send(message: MailMessage): Promise<MailResult> {
    await mkdir(this.directory, { recursive: true });

    const messageId = `${ulid()}@techpioasset.local`;
    const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${message.to.replace(/[^a-z0-9]/gi, '_')}.eml`;
    const filePath = path.join(this.directory, filename);

    const headers = [
      `Message-ID: <${messageId}>`,
      `Date: ${new Date().toUTCString()}`,
      `From: ${this.from}`,
      `To: ${message.to}`,
      ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
      // Encoded so non-ASCII subjects survive; a raw 8-bit header is invalid.
      `Subject: =?UTF-8?B?${Buffer.from(message.subject, 'utf8').toString('base64')}?=`,
      'MIME-Version: 1.0',
      'X-TechpioAsset-Simulated: true',
    ];

    let body: string;
    if (message.html) {
      const boundary = `----techpioasset-${ulid()}`;
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      body = [
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        message.text,
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        '',
        message.html,
        `--${boundary}--`,
        '',
      ].join('\r\n');
    } else {
      headers.push('Content-Type: text/plain; charset=UTF-8');
      body = `${message.text}\r\n`;
    }

    await writeFile(filePath, `${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8');

    this.logger.log(
      `SIMULATED email to ${message.to} — "${message.subject}" written to ${filePath}`,
    );
    return { messageId, simulated: true, storedAt: filePath };
  }
}
