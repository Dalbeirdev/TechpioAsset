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

export abstract class AiDocumentProvider {
  abstract readonly name: string;
  abstract extract(input: ExtractInput): Promise<ExtractionResult>;
}
