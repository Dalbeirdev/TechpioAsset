import { Injectable, Logger } from '@nestjs/common';
import { ChatProvider, type ChatMessage, type ChatResult } from './chat.provider.js';

/** Records chat posts instead of sending them. */
@Injectable()
export class MockChatProvider extends ChatProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockChatProvider.name);
  private readonly posted: { webhookUrl: string | null; message: ChatMessage }[] = [];

  async post(webhookUrl: string | null, message: ChatMessage): Promise<ChatResult> {
    if (!webhookUrl) return { delivered: false, simulated: true };
    this.posted.push({ webhookUrl, message });
    this.logger.log(`SIMULATED chat post "${message.title}" — not actually delivered`);
    return { delivered: true, simulated: true };
  }

  recorded(): readonly { webhookUrl: string | null; message: ChatMessage }[] {
    return this.posted;
  }
}
