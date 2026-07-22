import { Injectable, Logger } from '@nestjs/common';
import { ChatProvider, type ChatMessage, type ChatResult } from './chat.provider.js';

/**
 * Real webhook delivery for Teams and Slack.
 *
 * Both accept a simple JSON POST to an incoming-webhook URL, so one
 * implementation serves both: a Teams-style card and a Slack-style `text`
 * payload are sent together, and each service reads the field it understands.
 * Selected with CHAT_PROVIDER=webhook.
 */
@Injectable()
export class WebhookChatProvider extends ChatProvider {
  readonly name = 'webhook';
  private readonly logger = new Logger(WebhookChatProvider.name);

  async post(webhookUrl: string | null, message: ChatMessage): Promise<ChatResult> {
    if (!webhookUrl) return { delivered: false, simulated: false };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Slack reads `text`; Teams reads `title`/`text`. Sending both is
          // harmless and lets one webhook config target either service.
          title: message.title,
          text: message.linkUrl ? `${message.text}\n${message.linkUrl}` : message.text,
        }),
      });
      return { delivered: response.ok, simulated: false };
    } catch (error) {
      this.logger.warn(`Chat webhook failed: ${(error as Error).message}`);
      return { delivered: false, simulated: false };
    }
  }
}
