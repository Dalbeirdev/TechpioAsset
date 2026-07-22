import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { AppError } from '../../common/errors/app-error.js';
import {
  AiDocumentProvider,
  type ExtractInput,
  type ExtractionResult,
} from './ai-document.provider.js';

/**
 * Azure AI Document Intelligence extractor (spec section 9 recommended default).
 *
 * The integration shape is real — it targets the prebuilt-invoice model's REST
 * contract — but the SDK dependency and a live subscription are not present in
 * this environment, so the network call is left unimplemented on purpose rather
 * than faked. It throws a clear error if selected without being finished, so it
 * can never masquerade as working. `MockAiProvider` covers development.
 */
@Injectable()
export class AzureAiProvider extends AiDocumentProvider {
  readonly name = 'azure';
  private readonly logger = new Logger(AzureAiProvider.name);
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(config: AppConfig) {
    super();
    this.endpoint = config.get('AZURE_DOC_INTELLIGENCE_ENDPOINT') ?? '';
    this.apiKey = config.get('AZURE_DOC_INTELLIGENCE_KEY') ?? '';
  }

  async extract(_input: ExtractInput): Promise<ExtractionResult> {
    // The intended flow, documented so completing it is mechanical:
    //   1. POST the bytes to
    //      `${endpoint}/documentintelligence/documentModels/prebuilt-invoice:analyze`
    //      with `Ocp-Apim-Subscription-Key: ${apiKey}` and the correct content type.
    //   2. Poll the operation-location URL until `status === 'succeeded'`.
    //   3. Map `analyzeResult.documents[0].fields` (VendorName, InvoiceId,
    //      InvoiceDate, InvoiceTotal, SubTotal, TotalTax, Items[]) into
    //      ExtractionResult, carrying each field's `confidence`.
    //   4. Set simulated:false, provider:'azure', costUsd from the page count.
    //
    // Left unimplemented deliberately: a half-working call that silently returned
    // partial data would violate spec section 28's "do not silently pretend that
    // an external API call succeeded."
    this.logger.error(
      'Azure Document Intelligence provider selected but not implemented in this build',
    );
    throw new AppError(
      'DEPENDENCY_UNAVAILABLE',
      'Azure Document Intelligence is not available in this environment',
      {
        detail:
          'Set AI_PROVIDER=mock for development, or complete the Azure integration and supply credentials.',
      },
    );
  }
}
