import { describe, it, expect } from 'vitest';
import { validateUpload } from './file-validation.js';

/** Minimal valid file headers for each accepted type. */
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypheic', 'ascii'),
  Buffer.alloc(8),
]);

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'];

describe('file validation (spec sections 8, 20)', () => {
  it.each([
    ['PDF', PDF, 'application/pdf'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['HEIC', HEIC, 'image/heic'],
  ])('accepts a valid %s and detects its true type', (_label, data, expected) => {
    const result = validateUpload({
      data,
      declaredMime: 'application/octet-stream',
      allowedMimes: ALLOWED,
      maxBytes: 1024,
    });
    expect(result.contentType).toBe(expected);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an empty file', () => {
    expect(() =>
      validateUpload({
        data: Buffer.alloc(0),
        declaredMime: 'application/pdf',
        allowedMimes: ALLOWED,
        maxBytes: 1024,
      }),
    ).toThrow(/empty/i);
  });

  it('rejects a file over the size limit', () => {
    const big = Buffer.concat([PDF, Buffer.alloc(2048)]);
    expect(() =>
      validateUpload({
        data: big,
        declaredMime: 'application/pdf',
        allowedMimes: ALLOWED,
        maxBytes: 1024,
      }),
    ).toThrow(/size/i);
  });

  // The security-critical case: a client claiming PDF while sending something else.
  it('trusts the bytes, not the declared MIME type', () => {
    const executable = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ — a Windows PE
    expect(() =>
      validateUpload({
        data: executable,
        declaredMime: 'application/pdf', // lie
        allowedMimes: ALLOWED,
        maxBytes: 1024,
      }),
    ).toThrow(/not recognised|not an accepted/i);
  });

  it('rejects a real image type that is not on the allowed list', () => {
    expect(() =>
      validateUpload({
        data: PNG,
        declaredMime: 'image/png',
        allowedMimes: ['application/pdf'],
        maxBytes: 1024,
      }),
    ).toThrow(/not an accepted/i);
  });

  it('accepts image/jpg as a synonym for the detected image/jpeg', () => {
    const result = validateUpload({
      data: JPEG,
      declaredMime: 'image/jpg',
      allowedMimes: ALLOWED,
      maxBytes: 1024,
    });
    expect(result.contentType).toBe('image/jpeg');
  });
});
