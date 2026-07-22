/**
 * Optional chat integration — Microsoft Teams / Slack (spec section 19).
 *
 * Behind a provider interface like everything external. Off by default; a company
 * opts in by configuring a webhook URL. The mock records instead of posting.
 */

export interface ChatMessage {
  title: string;
  text: string;
  linkUrl?: string;
}

export interface ChatResult {
  delivered: boolean;
  simulated: boolean;
}

export abstract class ChatProvider {
  abstract readonly name: string;
  /**
   * Posts to a company's configured webhook. A company with no webhook is a
   * no-op success, not an error — most companies do not use chat integration.
   */
  abstract post(webhookUrl: string | null, message: ChatMessage): Promise<ChatResult>;
}
