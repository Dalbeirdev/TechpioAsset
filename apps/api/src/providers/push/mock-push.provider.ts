import { Injectable, Logger } from '@nestjs/common';
import { PushProvider, type PushMessage, type PushResult } from './push.provider.js';

/**
 * Records push messages instead of sending them.
 *
 * Keeps the last N messages in memory so a test or a developer can assert what
 * *would* have been delivered, without any device or Expo account. Every result
 * is flagged simulated.
 */
@Injectable()
export class MockPushProvider extends PushProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockPushProvider.name);
  private readonly sent: PushMessage[] = [];

  async send(message: PushMessage): Promise<PushResult> {
    this.sent.push(message);
    if (this.sent.length > 200) this.sent.shift();
    this.logger.log(
      `SIMULATED push to ${message.tokens.length} device(s): "${message.title}" — not actually delivered`,
    );
    return { accepted: message.tokens.length, simulated: true, invalidTokens: [] };
  }

  /** Test/dev helper: the messages that would have been delivered. */
  recorded(): readonly PushMessage[] {
    return this.sent;
  }
}
