/**
 * Mail delivery behind a provider interface (spec section 28).
 *
 * The mock writes real .eml files to disk rather than discarding the message, so
 * a developer can open and read exactly what would have been sent. It reports
 * `simulated: true`, and nothing in the system is allowed to present that as a
 * delivered email.
 */

export interface MailAttachment {
  filename: string;
  /** Text content; reports are CSV/SpreadsheetML strings (v2.6 A2). */
  content: string;
  contentType: string;
  /** Set for binary content carried as base64, e.g. the inline brand logo. */
  encoding?: 'base64';
  /**
   * Content-ID. Set it to reference the part from the HTML body as
   * `<img src="cid:...">`, which is how an image reaches the reader without a
   * remote fetch their mail client will block. A part with a cid is inline: it
   * belongs to the body, and is not offered as a file to save.
   */
  cid?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text is always supplied; html is optional and progressive. */
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
}

export interface MailResult {
  messageId: string;
  /** True when no external service was contacted. */
  simulated: boolean;
  /** Where a simulated message was written, for the developer to open. */
  storedAt?: string;
}

export abstract class MailProvider {
  abstract readonly name: string;
  abstract send(message: MailMessage): Promise<MailResult>;
}
