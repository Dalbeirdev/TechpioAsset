import { describe, it, expect, vi } from 'vitest';
import type { AppConfig } from '../../config/config.module.js';
import { AppError } from '../../common/errors/app-error.js';
import { AnthropicAiProvider } from './anthropic-ai.provider.js';
import type { ExtractInput } from './ai-document.provider.js';

/**
 * Unit tests for the Claude extractor. No network: the SDK client is stubbed, so
 * these assert the request shaping and response mapping, not the model itself.
 */

const config = {
  get: (key: string) => (key === 'ANTHROPIC_MODEL' ? 'claude-opus-5' : 'test-key'),
} as unknown as AppConfig;

const PDF_INPUT: ExtractInput = {
  data: Buffer.from('%PDF-1.7 fake'),
  contentType: 'application/pdf',
  fileName: 'invoice.pdf',
};

/** Shape a fake Messages API reply carrying the structured-output JSON. */
function fakeMessage(json: unknown, overrides: Record<string, unknown> = {}) {
  return {
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '...', signature: 's' },
      { type: 'text', text: JSON.stringify(json) },
    ],
    usage: { input_tokens: 2000, output_tokens: 500 },
    ...overrides,
  };
}

function providerWithReply(reply: unknown): AnthropicAiProvider {
  const provider = new AnthropicAiProvider(config);
  const create = vi.fn().mockResolvedValue(reply);
  (provider as unknown as { client: { messages: { create: typeof create } } }).client = {
    messages: { create },
  };
  return provider;
}

const GOOD_EXTRACTION = {
  vendorName: { value: 'Acme Corp', confidence: 0.95 },
  invoiceNumber: { value: 'INV-42', confidence: 0.9 },
  invoiceDate: { value: '2026-06-15', confidence: 0.88 },
  currency: { value: 'USD', confidence: 0.99 },
  subtotal: { value: '1000.00', confidence: 0.9 },
  tax: { value: '100.00', confidence: 0.9 },
  discount: { value: null, confidence: 0.5 },
  shipping: { value: null, confidence: 0.5 },
  total: { value: '1100.00', confidence: 0.92 },
  lines: [
    {
      lineNumber: 1,
      description: { value: 'Widget', confidence: 0.9 },
      quantity: { value: '2', confidence: 0.9 },
      unitPrice: { value: '500.00', confidence: 0.9 },
      lineTotal: { value: '1000.00', confidence: 0.9 },
      serialNumbers: ['SN-1', 'SN-2'],
    },
  ],
  overallConfidence: 0.91,
};

describe('AnthropicAiProvider', () => {
  it('maps a structured reply into a non-simulated ExtractionResult', async () => {
    const provider = providerWithReply(fakeMessage(GOOD_EXTRACTION));
    const result = await provider.extract(PDF_INPUT);

    expect(result.simulated).toBe(false);
    expect(result.provider).toBe('anthropic');
    expect(result.modelName).toBe('claude-opus-5');
    expect(result.vendorName.value).toBe('Acme Corp');
    expect(result.total.value).toBe('1100.00');
    expect(result.discount.value).toBeNull();
    expect(result.overallConfidence).toBeCloseTo(0.91);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.serialNumbers).toEqual(['SN-1', 'SN-2']);
    // opus-5 pricing: 2000 in @ $5/MTok + 500 out @ $25/MTok.
    expect(result.costUsd).toBeCloseTo((2000 * 5 + 500 * 25) / 1_000_000);
  });

  it('sends the PDF as a base64 document block with structured output', async () => {
    const provider = providerWithReply(fakeMessage(GOOD_EXTRACTION));
    await provider.extract(PDF_INPUT);
    const create = (provider as unknown as { client: { messages: { create: ReturnType<typeof vi.fn> } } })
      .client.messages.create;
    const params = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.output_config).toEqual({
      format: { type: 'json_schema', schema: expect.any(Object) },
    });
    const content = (params.messages as { content: Array<{ type: string }> }[])[0]!.content;
    expect(content[0]!.type).toBe('document');
  });

  it('clamps out-of-range confidences to 0..1', async () => {
    const provider = providerWithReply(
      fakeMessage({ ...GOOD_EXTRACTION, overallConfidence: 1.5, vendorName: { value: 'X', confidence: -2 } }),
    );
    const result = await provider.extract(PDF_INPUT);
    expect(result.overallConfidence).toBe(1);
    expect(result.vendorName.confidence).toBe(0);
  });

  it('rejects an unsupported media type before calling the API', async () => {
    const provider = providerWithReply(fakeMessage(GOOD_EXTRACTION));
    await expect(
      provider.extract({ ...PDF_INPUT, contentType: 'image/heic' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('wraps SDK failures as AI_PROVIDER_ERROR', async () => {
    const provider = new AnthropicAiProvider(config);
    const create = vi.fn().mockRejectedValue(new Error('429 overloaded'));
    (provider as unknown as { client: { messages: { create: typeof create } } }).client = {
      messages: { create },
    };
    await expect(provider.extract(PDF_INPUT)).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
  });

  it('treats a refusal stop reason as a provider error', async () => {
    const provider = providerWithReply(fakeMessage(GOOD_EXTRACTION, { stop_reason: 'refusal' }));
    await expect(provider.extract(PDF_INPUT)).rejects.toBeInstanceOf(AppError);
  });

  it('reports null cost for an unknown model', async () => {
    const cfg = {
      get: (key: string) => (key === 'ANTHROPIC_MODEL' ? 'some-future-model' : 'k'),
    } as unknown as AppConfig;
    const provider = new AnthropicAiProvider(cfg);
    const create = vi.fn().mockResolvedValue(fakeMessage(GOOD_EXTRACTION));
    (provider as unknown as { client: { messages: { create: typeof create } } }).client = {
      messages: { create },
    };
    const result = await provider.extract(PDF_INPUT);
    expect(result.costUsd).toBeNull();
  });
});
