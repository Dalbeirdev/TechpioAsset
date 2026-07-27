import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../../config/config.module.js';
import { AppError } from '../../common/errors/app-error.js';
import {
  AiDocumentProvider,
  type ExtractInput,
  type ExtractedField,
  type ExtractedLine,
  type ExtractionResult,
} from './ai-document.provider.js';

/**
 * Anthropic (Claude) invoice extractor — a real, non-simulated provider.
 *
 * It sends the uploaded document (PDF or image) to the Messages API and
 * constrains the reply to a JSON schema (structured outputs), so the model reads
 * the actual invoice and returns field values plus a self-assessed confidence per
 * field. It only ever *extracts* — spec section 9 keeps every financial and
 * quantity check in the deterministic engine, and this output is a suggestion a
 * human confirms. Results are flagged `simulated: false`; a failed call throws
 * (caught upstream and surfaced as AI_FAILED) rather than returning partial data.
 */
@Injectable()
export class AnthropicAiProvider extends AiDocumentProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicAiProvider.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: AppConfig) {
    super();
    this.model = config.get('ANTHROPIC_MODEL');
    // Validated at boot (env.schema): AI_PROVIDER=anthropic requires the key.
    this.client = new Anthropic({ apiKey: config.get('ANTHROPIC_API_KEY') ?? '' });
  }

  async extract(input: ExtractInput): Promise<ExtractionResult> {
    const started = Date.now();
    const source = this.buildSource(input);

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: 12000,
        // Adaptive thinking helps the model read noisy scans and reconcile totals.
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [source, { type: 'text', text: USER_PROMPT }],
          },
        ],
        // Constrain the reply to our schema so we always get parseable JSON.
        output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      });
    } catch (error) {
      // Surface the provider failure with a catalogued code; the upload service
      // records it as AI_FAILED and the invoice falls back to manual review.
      throw new AppError('AI_PROVIDER_ERROR', 'Claude extraction request failed', {
        detail: (error as Error).message,
        cause: error,
      });
    }

    if (message.stop_reason === 'refusal') {
      throw new AppError('AI_PROVIDER_ERROR', 'Claude declined to process this document');
    }

    const raw = this.firstJsonText(message);
    let parsed: RawExtraction;
    try {
      parsed = JSON.parse(raw) as RawExtraction;
    } catch {
      throw new AppError('AI_PROVIDER_ERROR', 'Claude returned an unparseable extraction');
    }

    const durationMs = Date.now() - started;
    const costUsd = this.estimateCostUsd(message.usage);
    this.logger.log(
      `Extracted ${input.fileName} with ${this.model} ` +
        `(confidence ${parsed.overallConfidence?.toFixed?.(2) ?? '?'}, ${durationMs}ms)`,
    );

    return this.toResult(parsed, durationMs, costUsd);
  }

  /** Turn the uploaded bytes into a document (PDF) or image content block. */
  private buildSource(input: ExtractInput): Anthropic.ContentBlockParam {
    const data = input.data.toString('base64');
    if (input.contentType === 'application/pdf') {
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
    }
    if (
      input.contentType === 'image/jpeg' ||
      input.contentType === 'image/png' ||
      input.contentType === 'image/gif' ||
      input.contentType === 'image/webp'
    ) {
      return { type: 'image', source: { type: 'base64', media_type: input.contentType, data } };
    }
    // Claude vision accepts JPEG/PNG/GIF/WebP and PDF only. HEIC and anything
    // else must be converted upstream; refuse clearly rather than send garbage.
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      `Claude extraction does not support ${input.contentType}`,
      { detail: 'Supported: application/pdf, image/jpeg, image/png, image/gif, image/webp.' },
    );
  }

  /** First text block holds the structured-output JSON (thinking blocks precede it). */
  private firstJsonText(message: Anthropic.Message): string {
    for (const block of message.content) {
      if (block.type === 'text') return block.text;
    }
    throw new AppError('AI_PROVIDER_ERROR', 'Claude returned no text content');
  }

  private estimateCostUsd(usage: Anthropic.Usage): number | null {
    const price = MODEL_PRICING[this.model];
    if (!price) return null;
    const inputTokens =
      usage.input_tokens +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    return (inputTokens * price.input + usage.output_tokens * price.output) / 1_000_000;
  }

  private toResult(
    parsed: RawExtraction,
    durationMs: number,
    costUsd: number | null,
  ): ExtractionResult {
    const overall = clampConfidence(parsed.overallConfidence);
    return {
      vendorName: nullableField(parsed.vendorName),
      invoiceNumber: nullableField(parsed.invoiceNumber),
      invoiceDate: nullableField(parsed.invoiceDate),
      currency: nullableField(parsed.currency),
      subtotal: nullableField(parsed.subtotal),
      tax: nullableField(parsed.tax),
      discount: nullableField(parsed.discount),
      shipping: nullableField(parsed.shipping),
      total: nullableField(parsed.total),
      lines: (parsed.lines ?? []).map((line, index) => this.toLine(line, index)),
      overallConfidence: overall,
      simulated: false,
      provider: this.name,
      modelName: this.model,
      durationMs,
      costUsd,
    };
  }

  private toLine(line: RawLine, index: number): ExtractedLine {
    return {
      lineNumber: typeof line.lineNumber === 'number' ? line.lineNumber : index + 1,
      description: stringField(line.description),
      quantity: stringField(line.quantity),
      unitPrice: stringField(line.unitPrice),
      lineTotal: stringField(line.lineTotal),
      ...(Array.isArray(line.serialNumbers) && line.serialNumbers.length > 0
        ? { serialNumbers: line.serialNumbers.map(String) }
        : {}),
    };
  }
}

/** Per-MTok pricing (USD) for cost estimation; unknown models report null cost. */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-fable-5': { input: 10, output: 50 },
};

const SYSTEM_PROMPT =
  'You are an invoice data extractor. Read the attached document and return the ' +
  'requested fields exactly as they appear on the invoice. Do not compute, correct, ' +
  'or reconcile values — a separate deterministic engine verifies the arithmetic. ' +
  'Report money as plain decimal strings without currency symbols or thousands ' +
  'separators (e.g. "1250.00"), dates as YYYY-MM-DD, and use null for any field ' +
  'that is genuinely absent from the document. For every field give a confidence ' +
  'from 0 to 1 reflecting how certain you are that you read it correctly.';

const USER_PROMPT =
  'Extract the invoice fields and line items from this document into the required ' +
  'JSON structure. Include one entry in "lines" per line item, in order.';

/** JSON schema for structured outputs. Kept flat — no unsupported constraints. */
const CONFIDENCE_FIELD = (nullable: boolean) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    value: nullable ? { anyOf: [{ type: 'string' }, { type: 'null' }] } : { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['value', 'confidence'],
});

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    vendorName: CONFIDENCE_FIELD(true),
    invoiceNumber: CONFIDENCE_FIELD(true),
    invoiceDate: CONFIDENCE_FIELD(true),
    currency: CONFIDENCE_FIELD(true),
    subtotal: CONFIDENCE_FIELD(true),
    tax: CONFIDENCE_FIELD(true),
    discount: CONFIDENCE_FIELD(true),
    shipping: CONFIDENCE_FIELD(true),
    total: CONFIDENCE_FIELD(true),
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lineNumber: { type: 'integer' },
          description: CONFIDENCE_FIELD(false),
          quantity: CONFIDENCE_FIELD(false),
          unitPrice: CONFIDENCE_FIELD(false),
          lineTotal: CONFIDENCE_FIELD(false),
          serialNumbers: { type: 'array', items: { type: 'string' } },
        },
        required: ['lineNumber', 'description', 'quantity', 'unitPrice', 'lineTotal'],
      },
    },
    overallConfidence: { type: 'number' },
  },
  required: [
    'vendorName',
    'invoiceNumber',
    'invoiceDate',
    'currency',
    'subtotal',
    'tax',
    'discount',
    'shipping',
    'total',
    'lines',
    'overallConfidence',
  ],
} as const;

interface RawField {
  value?: string | null;
  confidence?: number;
}
interface RawLine {
  lineNumber?: number;
  description?: RawField;
  quantity?: RawField;
  unitPrice?: RawField;
  lineTotal?: RawField;
  serialNumbers?: unknown[];
}
interface RawExtraction {
  vendorName?: RawField;
  invoiceNumber?: RawField;
  invoiceDate?: RawField;
  currency?: RawField;
  subtotal?: RawField;
  tax?: RawField;
  discount?: RawField;
  shipping?: RawField;
  total?: RawField;
  lines?: RawLine[];
  overallConfidence?: number;
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function nullableField(field: RawField | undefined): ExtractedField<string | null> {
  return {
    value: field?.value ?? null,
    confidence: clampConfidence(field?.confidence),
  };
}

function stringField(field: RawField | undefined): ExtractedField<string> {
  return {
    value: field?.value ?? '',
    confidence: clampConfidence(field?.confidence),
  };
}
