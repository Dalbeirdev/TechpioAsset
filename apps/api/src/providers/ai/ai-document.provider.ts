import { AppError } from '../../common/errors/app-error.js';

/**
 * AI document extraction behind a provider interface (spec sections 9, 28).
 *
 * The provider *extracts* — it reads a document and proposes field values and
 * line items with confidence scores. It never *verifies*: spec section 9 keeps
 * all exact financial and quantity checks in the deterministic engine
 * (packages/domain), and this provider's output is only ever a suggestion a human
 * confirms. Every result carries a confidence and a `simulated` flag.
 */

export interface ExtractedField<T> {
  value: T;
  /** 0..1. Below the configured threshold the UI highlights it for review. */
  confidence: number;
}

export interface ExtractedLine {
  lineNumber: number;
  description: ExtractedField<string>;
  quantity: ExtractedField<string>;
  unitPrice: ExtractedField<string>;
  lineTotal: ExtractedField<string>;
  serialNumbers?: string[];
}

export interface ExtractionResult {
  vendorName: ExtractedField<string | null>;
  invoiceNumber: ExtractedField<string | null>;
  invoiceDate: ExtractedField<string | null>;
  currency: ExtractedField<string | null>;
  subtotal: ExtractedField<string | null>;
  tax: ExtractedField<string | null>;
  discount: ExtractedField<string | null>;
  shipping: ExtractedField<string | null>;
  total: ExtractedField<string | null>;
  lines: ExtractedLine[];
  overallConfidence: number;
  /** True when produced without contacting any external service. */
  simulated: boolean;
  provider: string;
  modelName: string;
  durationMs: number;
  /** USD cost when the provider reports one; null for the mock. */
  costUsd: number | null;
}

export interface ExtractInput {
  data: Buffer;
  contentType: string;
  /** Original filename, used by the mock to produce stable pseudo-data. */
  fileName: string;
}

/**
 * Warranty paste-and-extract (v2.16): the technician copies the manufacturer's
 * warranty page and the provider finds the coverage end date in it. Same
 * contract as invoice extraction — a *proposal* with a confidence, confirmed by
 * a human before anything is saved.
 */
export interface WarrantyTextInput {
  /** Text pasted from the vendor's warranty/support page. */
  text: string;
  /** The asset's serial / service tag, for the serialSeen cross-check. */
  serialNumber?: string | null;
  /** Detected manufacturer label (e.g. "Dell"), context for the model. */
  vendorLabel?: string | null;
}

export interface WarrantyTextResult {
  /** YYYY-MM-DD, or null when the text carries no coverage end date. */
  warrantyEndDate: string | null;
  /** The entitlement the date belongs to (e.g. "ProSupport"), when named. */
  warrantyType: string | null;
  /** Whether the pasted text mentions the asset's serial — a wrong-device tell. */
  serialSeen: boolean;
  confidence: number;
  simulated: boolean;
  provider: string;
  modelName: string;
  durationMs: number;
  costUsd: number | null;
}

export abstract class AiDocumentProvider {
  abstract readonly name: string;
  abstract extract(input: ExtractInput): Promise<ExtractionResult>;

  /**
   * Providers that cannot read freeform text inherit this refusal — Azure
   * Document Intelligence runs document models, not text comprehension, so for
   * it the honest answer is "not supported", not a bad guess.
   */
  extractWarrantyText(_input: WarrantyTextInput): Promise<WarrantyTextResult> {
    return Promise.reject(
      new AppError(
        'AI_PROVIDER_ERROR',
        `The ${this.name} provider does not support warranty text extraction`,
        { detail: 'Configure the Anthropic Claude provider under Platform → AI provider.' },
      ),
    );
  }
}
