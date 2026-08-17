import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { AppConfig } from '../../config/config.module.js';
import {
  MailProvider,
  type MailAttachment,
  type MailMessage,
  type MailResult,
} from './mail.provider.js';

/**
 * Assemble the MIME body, nesting only the levels the message actually needs.
 *
 * The shape matters: an inline image is addressed by Content-ID from the HTML,
 * and a reader only resolves that when the image sits beside the body inside a
 * multipart/related. Put it in multipart/mixed instead and the image arrives as
 * a file to save while the HTML shows a broken box. So:
 *
 *   mixed     - only when there are files to save
 *     related - only when there are inline parts
 *       alternative - only when there is HTML beside the text
 */
function buildBody(message: MailMessage): { contentType: string; body: string } {
  const inline = (message.attachments ?? []).filter((a) => a.cid);
  const files = (message.attachments ?? []).filter((a) => !a.cid);

  const encode = (attachment: MailAttachment): string =>
    attachment.encoding === 'base64'
      ? attachment.content.replace(/(.{76})/g, '$1\r\n')
      : Buffer.from(attachment.content, 'utf8').toString('base64');

  const part = (attachment: MailAttachment): string[] => [
    `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    ...(attachment.cid
      ? [`Content-ID: <${attachment.cid}>`, `Content-Disposition: inline; filename="${attachment.filename}"`]
      : [`Content-Disposition: attachment; filename="${attachment.filename}"`]),
    '',
    encode(attachment),
  ];

  const wrap = (
    subtype: string,
    sections: string[][],
  ): { contentType: string; body: string } => {
    const boundary = `----techpioasset-${ulid()}`;
    const lines: string[] = [];
    for (const section of sections) lines.push(`--${boundary}`, ...section);
    lines.push(`--${boundary}--`, '');
    return { contentType: `multipart/${subtype}; boundary="${boundary}"`, body: lines.join('\r\n') };
  };

  const textPart = ['Content-Type: text/plain; charset=UTF-8', '', message.text];

  let current: { contentType: string; body: string } = message.html
    ? wrap('alternative', [
        textPart,
        ['Content-Type: text/html; charset=UTF-8', '', message.html],
      ])
    : { contentType: 'text/plain; charset=UTF-8', body: `${message.text}\r\n` };

  if (inline.length) {
    current = wrap('related', [
      [`Content-Type: ${current.contentType}`, '', current.body],
      ...inline.map(part),
    ]);
  }
  if (files.length) {
    current = wrap('mixed', [
      [`Content-Type: ${current.contentType}`, '', current.body],
      ...files.map(part),
    ]);
  }
  return current;
}

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

    const { contentType, body } = buildBody(message);
    headers.push(`Content-Type: ${contentType}`);

    await writeFile(filePath, `${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8');

    this.logger.log(
      `SIMULATED email to ${message.to} — "${message.subject}" written to ${filePath}`,
    );
    return { messageId, simulated: true, storedAt: filePath };
  }
}
