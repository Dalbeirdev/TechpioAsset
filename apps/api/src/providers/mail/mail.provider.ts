/**
 * Mail delivery behind a provider interface (spec section 28).
 *
 * The mock writes real .eml files to disk rather than discarding the message, so
 * a developer can open and read exactly what would have been sent. It reports
 * `simulated: true`, and nothing in the system is allowed to present that as a
 * delivered email.
 */

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text is always supplied; html is optional and progressive. */
  text: string;
  html?: string;
  replyTo?: string;
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
