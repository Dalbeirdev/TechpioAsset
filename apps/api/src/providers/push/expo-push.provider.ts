import { Injectable, Logger } from '@nestjs/common';
import { PushProvider, type PushMessage, type PushResult } from './push.provider.js';

/**
 * Expo push delivery (spec section 1).
 *
 * The integration shape is real — it targets Expo's push API at
 * https://exp.host/--/api/v2/push/send with the documented message format and
 * receipt handling — but it is left unimplemented here rather than half-wired,
 * because no Expo project or device tokens exist in this environment. It throws
 * a clear error if selected, so it can never masquerade as working; the mock
 * covers development.
 */
@Injectable()
export class ExpoPushProvider extends PushProvider {
  readonly name = 'expo';
  private readonly logger = new Logger(ExpoPushProvider.name);

  async send(_message: PushMessage): Promise<PushResult> {
    // Intended flow, documented so completing it is mechanical:
    //   1. Chunk tokens into batches of 100.
    //   2. POST each batch to https://exp.host/--/api/v2/push/send as
    //      [{ to, title, body, data }], with the EXPO_ACCESS_TOKEN bearer header.
    //   3. Read the ticket array; poll the receipts endpoint for DeviceNotRegistered
    //      errors and return those tokens in invalidTokens for pruning.
    this.logger.error('Expo push provider selected but not implemented in this build');
    throw new Error(
      'Expo push is not available in this environment. Set PUSH_PROVIDER=mock for development.',
    );
  }
}
