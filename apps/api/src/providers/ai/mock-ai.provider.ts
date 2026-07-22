import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  AiDocumentProvider,
  type ExtractInput,
  type ExtractionResult,
} from './ai-document.provider.js';

/**
 * Deterministic mock extractor.
 *
 * Contacts nothing external and never pretends to have. It derives stable
 * pseudo-values from the file's hash so the same document always "extracts" the
 * same way, which makes the review flow testable end to end without an Azure
 * subscription. Every result is flagged `simulated: true`, and callers surface
 * that to the reviewer — a simulated extraction is never presented as real.
 *
 * This exists so the deterministic verification engine and the human review UI
 * can be exercised now; it is not, and never claims to be, real OCR.
 */
@Injectable()
export class MockAiProvider extends AiDocumentProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockAiProvider.name);

  async extract(input: ExtractInput): Promise<ExtractionResult> {
    const started = Date.now();
    const seed = createHash('sha256').update(input.data).digest();

    // A confidence in a believable band, varied per document so the UI's
    // low-confidence highlighting has something to show.
    const confidence = 0.78 + (seed[0]! / 255) * 0.2; // 0.78..0.98
    const num = (offset: number, max: number) => (seed[offset]! % max) + 1;

    const qty = String(num(1, 3));
    const unit = `${num(2, 20) * 100}.00`;
    const lineTotal = (Number(qty) * Number(unit)).toFixed(2);

    this.logger.log(
      `SIMULATED extraction for ${input.fileName} (confidence ${confidence.toFixed(2)})`,
    );

    return {
      vendorName: { value: 'Simulated Vendor Ltd.', confidence },
      invoiceNumber: {
        value: `SIM-${seed.subarray(0, 3).toString('hex').toUpperCase()}`,
        confidence,
      },
      invoiceDate: { value: '2026-06-15', confidence },
      currency: { value: 'USD', confidence: 0.99 },
      subtotal: { value: lineTotal, confidence },
      tax: { value: '0.00', confidence },
      discount: { value: '0.00', confidence },
      shipping: { value: '0.00', confidence },
      total: { value: lineTotal, confidence },
      lines: [
        {
          lineNumber: 1,
          description: { value: 'Simulated line item', confidence },
          quantity: { value: qty, confidence },
          unitPrice: { value: unit, confidence },
          lineTotal: { value: lineTotal, confidence },
        },
      ],
      overallConfidence: confidence,
      simulated: true,
      provider: this.name,
      modelName: 'mock-deterministic-v1',
      durationMs: Date.now() - started,
      costUsd: null,
    };
  }
}
