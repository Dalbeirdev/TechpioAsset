import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  AiDocumentProvider,
  type ExtractInput,
  type ExtractionResult,
  type WarrantyTextInput,
  type WarrantyTextResult,
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

  /**
   * Deterministic warranty-date finder: scans the pasted text for unambiguous
   * date formats (ISO, "30 June 2027", "June 30, 2027") and reports the LATEST
   * one — vendor pages list purchase, ship and expiry dates, and expiry is the
   * furthest out. Slashed dates (30/06/2027) are deliberately ignored: without
   * a locale they are a guess, and this provider never guesses. Flagged
   * simulated so the UI says so.
   */
  override async extractWarrantyText(input: WarrantyTextInput): Promise<WarrantyTextResult> {
    const started = Date.now();
    const dates: string[] = [];

    for (const match of input.text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
      pushIsoDate(dates, Number(match[1]), Number(match[2]), Number(match[3]));
    }
    const months =
      '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
    const dayMonthYear = new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${months},?\\s+(20\\d{2})\\b`,
      'gi',
    );
    for (const match of input.text.matchAll(dayMonthYear)) {
      pushIsoDate(dates, Number(match[3]), monthIndex(match[2]!), Number(match[1]));
    }
    const monthDayYear = new RegExp(
      `\\b${months}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`,
      'gi',
    );
    for (const match of input.text.matchAll(monthDayYear)) {
      pushIsoDate(dates, Number(match[3]), monthIndex(match[1]!), Number(match[2]));
    }

    const latest = dates.length > 0 ? dates.sort().at(-1)! : null;
    const serial = input.serialNumber?.trim().toLowerCase();
    this.logger.log(`SIMULATED warranty extraction found ${dates.length} date(s)`);

    return {
      warrantyEndDate: latest,
      warrantyType: null,
      serialSeen: Boolean(serial && input.text.toLowerCase().includes(serial)),
      confidence: latest ? 0.85 : 0,
      simulated: true,
      provider: this.name,
      modelName: 'mock-deterministic-v1',
      durationMs: Date.now() - started,
      costUsd: null,
    };
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

function pushIsoDate(into: string[], year: number, month: number, day: number): void {
  if (month < 1 || month > 12 || day < 1 || day > 31) return;
  into.push(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );
}
