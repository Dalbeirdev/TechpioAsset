import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';
import { AiDocumentProvider } from '../src/providers/ai/ai-document.provider.js';

/**
 * Phase 3: invoices, deterministic verification, and AI enable/disable.
 *
 * The spy on AiDocumentProvider.extract is the load-bearing assertion of the
 * phase: it proves that with AI disabled the provider is never called, which is
 * spec section 10's central requirement.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let extractSpy: ReturnType<typeof vi.spyOn>;

// A minimal valid PDF so file validation accepts the upload.
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.7\n', 'ascii'),
  Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
  Buffer.from('1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'ascii'),
]);

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  // Spy on the actual resolved provider instance in the DI container.
  const provider = app.get(AiDocumentProvider);
  extractSpy = vi.spyOn(provider, 'extract');
});

afterAll(async () => {
  await app?.close();
});

async function setAiEnabled(enabled: boolean) {
  const response = await api(app)
    .patch('/api/v1/ai-config')
    .set(auth(s.superAdmin))
    .send({
      globallyEnabled: enabled,
      paused: false,
      featureModes: { INVOICE_OCR: 'MANUAL_REVIEW_REQUIRED' },
      humanReviewRequired: true,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

async function firstVendorId(): Promise<string> {
  const vendors = await api(app).get('/api/v1/vendors').set(auth(s.finance));
  return vendors.body.data[0].id;
}

describe('AI configuration (spec section 10)', () => {
  it('is readable only by a Super Admin', async () => {
    expect((await api(app).get('/api/v1/ai-config').set(auth(s.superAdmin))).status).toBe(200);
    expect((await api(app).get('/api/v1/ai-config').set(auth(s.finance))).status).toBe(403);
    expect((await api(app).get('/api/v1/ai-config').set(auth(s.employee))).status).toBe(403);
  });

  it('defaults to disabled with human review required', async () => {
    const response = await api(app).get('/api/v1/ai-config').set(auth(s.superAdmin));
    expect(response.body.data.config.humanReviewRequired).toBe(true);
    expect(response.body.data.config.automaticFinancialApproval).toBe(false);
  });
});

describe('upload with AI DISABLED (spec section 10)', () => {
  it('never calls the AI provider', async () => {
    await setAiEnabled(false);
    extractSpy.mockClear();

    const response = await api(app)
      .post('/api/v1/invoices/upload')
      .set(auth(s.finance))
      .attach('file', PDF, 'invoice-ai-off.pdf');

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    // The whole point: no document was submitted to any provider.
    expect(extractSpy).not.toHaveBeenCalled();
    expect(response.body.data.extraction.ran).toBe(false);
    // Deterministic verification still ran (section 10: rules keep working).
    expect(response.body.data.invoice.verifications).toBeDefined();
  });

  it('still accepts a fully manual invoice and verifies it deterministically', async () => {
    await setAiEnabled(false);
    extractSpy.mockClear();

    const vendorId = await firstVendorId();
    const response = await api(app)
      .post('/api/v1/invoices')
      .set(auth(s.finance))
      .send({
        vendorId,
        invoiceNumber: `MANUAL-${Date.now()}`,
        invoiceDate: '2026-06-01',
        currency: 'USD',
        subtotal: '2000.00',
        tax: '200.00',
        total: '2200.00',
        lines: [
          {
            lineNumber: 1,
            description: 'Laptop',
            quantity: 1,
            unitPrice: '1500.00',
            lineTotal: '1500.00',
          },
          {
            lineNumber: 2,
            description: 'Monitor',
            quantity: 1,
            unitPrice: '500.00',
            lineTotal: '500.00',
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(extractSpy).not.toHaveBeenCalled();
    // Clean invoice → the engine reports no cost error.
    const verification = response.body.data.verifications[0];
    expect(verification.outcome).not.toBe('COST_MISMATCH');
  });
});

describe('upload with AI ENABLED', () => {
  it('calls the provider and marks the result simulated', async () => {
    await setAiEnabled(true);
    extractSpy.mockClear();

    const response = await api(app)
      .post('/api/v1/invoices/upload')
      .set(auth(s.finance))
      .attach('file', PDF, 'invoice-ai-on.pdf');

    expect(response.status).toBe(201);
    expect(extractSpy).toHaveBeenCalledTimes(1);
    // Mock provider → simulated flag surfaced, never presented as real (section 28).
    expect(response.body.data.extraction.simulated).toBe(true);

    const extraction = response.body.data.invoice.extractions[0];
    expect(extraction.simulated).toBe(true);
    expect(extraction.provider).toBe('mock');

    await setAiEnabled(false); // leave the company back at the safe default
  });
});

describe('deterministic verification detects mismatches (spec section 26)', () => {
  async function manualInvoice(over: Record<string, unknown>) {
    const vendorId = await firstVendorId();
    return api(app)
      .post('/api/v1/invoices')
      .set(auth(s.finance))
      .send({
        vendorId,
        invoiceNumber: `VERIFY-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        invoiceDate: '2026-06-01',
        currency: 'USD',
        subtotal: '1000.00',
        tax: '0.00',
        total: '1000.00',
        lines: [
          {
            lineNumber: 1,
            description: 'Item',
            quantity: 1,
            unitPrice: '1000.00',
            lineTotal: '1000.00',
          },
        ],
        ...over,
      });
  }

  it('flags a cost mismatch', async () => {
    // Total that does not equal subtotal + tax.
    const response = await manualInvoice({ total: '9999.00' });
    expect(response.status).toBe(201);
    expect(response.body.data.verifications[0].outcome).toBe('COST_MISMATCH');
  });

  it('flags a line total that is not quantity × unit price', async () => {
    const response = await manualInvoice({
      subtotal: '1000.00',
      total: '1000.00',
      lines: [
        {
          lineNumber: 1,
          description: 'Item',
          quantity: 2,
          unitPrice: '1000.00',
          lineTotal: '1000.00',
        },
      ],
    });
    const issues = response.body.data.verifications[0].issues;
    expect(issues.some((i: { code: string }) => i.code === 'LINE_TOTAL_MISMATCH')).toBe(true);
  });

  it('flags a duplicate invoice number', async () => {
    const vendorId = await firstVendorId();
    const number = `DUP-${Date.now()}`;
    const body = {
      vendorId,
      invoiceNumber: number,
      invoiceDate: '2026-06-01',
      currency: 'USD',
      subtotal: '100.00',
      tax: '0.00',
      total: '100.00',
      lines: [
        {
          lineNumber: 1,
          description: 'Item',
          quantity: 1,
          unitPrice: '100.00',
          lineTotal: '100.00',
        },
      ],
    };
    const first = await api(app).post('/api/v1/invoices').set(auth(s.finance)).send(body);
    expect(first.status).toBe(201);

    // A second invoice with the same number must fail the unique constraint at
    // the database, surfaced as a catalogued duplicate error.
    const second = await api(app).post('/api/v1/invoices').set(auth(s.finance)).send(body);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DUPLICATE_INVOICE_NUMBER');
  });
});

describe('human decision (spec section 9)', () => {
  it('lets Finance verify an invoice', async () => {
    const vendorId = await firstVendorId();
    const created = await api(app)
      .post('/api/v1/invoices')
      .set(auth(s.finance))
      .send({
        vendorId,
        invoiceNumber: `HUMAN-${Date.now()}`,
        invoiceDate: '2026-06-01',
        currency: 'USD',
        subtotal: '500.00',
        tax: '0.00',
        total: '500.00',
        lines: [
          {
            lineNumber: 1,
            description: 'Item',
            quantity: 1,
            unitPrice: '500.00',
            lineTotal: '500.00',
          },
        ],
      });

    const decided = await api(app)
      .post(`/api/v1/invoices/${created.body.data.id}/decision`)
      .set(auth(s.finance))
      .send({ decision: 'VERIFIED', notes: 'Checked against the PO.' });

    expect(decided.status).toBe(201);
    expect(decided.body.data.verificationStatus).toBe('VERIFIED');
    expect(decided.body.data.verifications[0].decidedBy.email).toBe('finance@techpioasset.dev');
  });

  it('does not let a non-verifier decide', async () => {
    const vendorId = await firstVendorId();
    const created = await api(app)
      .post('/api/v1/invoices')
      .set(auth(s.finance))
      .send({
        vendorId,
        invoiceNumber: `NOAUTH-${Date.now()}`,
        invoiceDate: '2026-06-01',
        currency: 'USD',
        subtotal: '100.00',
        tax: '0.00',
        total: '100.00',
        lines: [
          {
            lineNumber: 1,
            description: 'Item',
            quantity: 1,
            unitPrice: '100.00',
            lineTotal: '100.00',
          },
        ],
      });

    // IT Admin can read nothing here and certainly cannot verify.
    const denied = await api(app)
      .post(`/api/v1/invoices/${created.body.data.id}/decision`)
      .set(auth(s.itAdmin))
      .send({ decision: 'VERIFIED' });
    expect(denied.status).toBe(403);
  });
});

describe('file validation on upload (spec sections 8, 20)', () => {
  it('rejects a non-document file even if named .pdf', async () => {
    await setAiEnabled(false);
    // A PNG signature under a .pdf name — the bytes are what count, but PNG is
    // an allowed image type, so use a plain-text buffer that matches nothing.
    const notADocument = Buffer.from('this is just text, not a document', 'ascii');
    const response = await api(app)
      .post('/api/v1/invoices/upload')
      .set(auth(s.finance))
      .attach('file', notADocument, 'malicious.pdf');
    expect(response.status).toBe(415);
  });
});

describe('invoice access control (spec section 3)', () => {
  it('denies an employee the invoices list', async () => {
    expect((await api(app).get('/api/v1/invoices').set(auth(s.employee))).status).toBe(403);
  });

  it('denies HR the invoices list (no financial permission)', async () => {
    expect((await api(app).get('/api/v1/invoices').set(auth(s.hr))).status).toBe(403);
  });

  it('allows Finance and Auditor to read invoices', async () => {
    expect((await api(app).get('/api/v1/invoices').set(auth(s.finance))).status).toBe(200);
    expect((await api(app).get('/api/v1/invoices').set(auth(s.auditor))).status).toBe(200);
  });
});
