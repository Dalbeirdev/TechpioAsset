import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { MfaService } from '../../auth/mfa.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  AiDocumentProvider,
  type ExtractInput,
  type ExtractionResult,
} from './ai-document.provider.js';
import { MockAiProvider } from './mock-ai.provider.js';
import { AzureAiProvider } from './azure-ai.provider.js';
import { AnthropicAiProvider } from './anthropic-ai.provider.js';

/**
 * AI provider routing (v2.15) - the same shape as mail routing, for the same
 * reason: the provider became configurable from the operator console, so it
 * can no longer be chosen once at boot. Order of preference:
 *
 *  1. Database settings (Platform → AI) - editable without a server login.
 *  2. Environment (AI_PROVIDER=azure|anthropic) - the original path.
 *  3. Mock - simulated extraction, the honest default.
 *
 * DB settings are re-read at most every 30 seconds; a save is effective on the
 * next extraction without a restart. The API key is decrypted only here, and
 * only long enough to construct the delegate.
 */
@Injectable()
export class RoutingAiProvider extends AiDocumentProvider {
  readonly name = 'routing';
  private readonly logger = new Logger(RoutingAiProvider.name);
  private readonly envProvider: AiDocumentProvider;
  private readonly envName: string;

  private cachedAt = 0;
  private cachedStamp: string | null = null;
  private delegate: AiDocumentProvider | null = null;
  private delegateName: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    private readonly config: AppConfig,
  ) {
    super();
    switch (config.get('AI_PROVIDER')) {
      case 'anthropic':
        this.envProvider = new AnthropicAiProvider(config);
        this.envName = 'anthropic';
        break;
      case 'azure':
        this.envProvider = new AzureAiProvider(config);
        this.envName = 'azure';
        break;
      default:
        this.envProvider = new MockAiProvider();
        this.envName = 'mock';
    }
  }

  async extract(input: ExtractInput): Promise<ExtractionResult> {
    const db = await this.dbDelegate();
    return (db ?? this.envProvider).extract(input);
  }

  /** What an extraction would actually use right now, and where it came from. */
  async effective(): Promise<{ provider: string; source: 'operator' | 'environment' }> {
    const db = await this.dbDelegate();
    return db
      ? { provider: this.delegateName ?? 'mock', source: 'operator' }
      : { provider: this.envName, source: 'environment' };
  }

  /** Called by the operator console after a write, so its own next read
   * reflects the change instantly instead of after the 30s cache window. */
  bustCache(): void {
    this.cachedAt = 0;
  }

  private async dbDelegate(): Promise<AiDocumentProvider | null> {
    const now = Date.now();
    if (now - this.cachedAt > 30_000) {
      this.cachedAt = now;
      const row = await this.prisma.client.aiSettings
        .findUnique({ where: { id: 'default' } })
        .catch(() => null);
      const stamp = row ? row.updatedAt.toISOString() : null;
      if (stamp !== this.cachedStamp) {
        this.cachedStamp = stamp;
        this.delegate = null;
        this.delegateName = null;
        if (row) {
          const apiKey = this.mfa.decryptSecret(row.apiKeyEncrypted) ?? undefined;
          if (row.provider === 'anthropic' && apiKey) {
            this.delegate = new AnthropicAiProvider(this.config, {
              apiKey,
              model: row.model ?? undefined,
            });
            this.delegateName = 'anthropic';
          } else if (row.provider === 'azure' && apiKey && row.endpoint) {
            this.delegate = new AzureAiProvider(this.config, {
              endpoint: row.endpoint,
              apiKey,
            });
            this.delegateName = 'azure';
          } else if (row.provider === 'mock') {
            // An explicit operator choice of simulation beats the env.
            this.delegate = new MockAiProvider();
            this.delegateName = 'mock';
          } else {
            this.logger.warn(
              `AI settings row is incomplete (provider=${row.provider}); falling back to environment`,
            );
          }
        }
      }
    }
    return this.delegate;
  }
}
