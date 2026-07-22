import { createHash } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';

/**
 * File validation for uploads (spec sections 8, 20).
 *
 * Spec section 8 permits PDF, JPG, JPEG, PNG, HEIC. Validation checks the actual
 * bytes, not the declared MIME type or extension: a client can claim anything, so
 * the magic-number signature is the only trustworthy evidence of what a file is.
 */

export interface AllowedType {
  mime: string;
  /** Leading-byte signatures that identify the format. */
  signatures: number[][];
}

const ALLOWED: AllowedType[] = [
  { mime: 'application/pdf', signatures: [[0x25, 0x50, 0x44, 0x46]] }, // %PDF
  {
    mime: 'image/jpeg',
    signatures: [[0xff, 0xd8, 0xff]],
  },
  {
    mime: 'image/png',
    signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  // HEIC/HEIF carries an ftyp box at offset 4; the brand follows. Matched below
  // by locating 'ftyp' then a heic/heif/mif1 brand, since the first four bytes
  // are a length prefix rather than a fixed signature.
];

function matchesSignature(data: Buffer, signature: number[]): boolean {
  if (data.length < signature.length) return false;
  return signature.every((byte, index) => data[index] === byte);
}

function isHeic(data: Buffer): boolean {
  if (data.length < 12) return false;
  const ftyp = data.subarray(4, 8).toString('ascii');
  if (ftyp !== 'ftyp') return false;
  const brand = data.subarray(8, 12).toString('ascii');
  return ['heic', 'heix', 'heif', 'mif1', 'hevc'].includes(brand);
}

/**
 * Verifies a buffer against the allowed types and size, and returns its hash and
 * true content type. Throws an AppError the exception filter turns into a clean
 * 4xx rather than leaking a stack trace.
 */
export function validateUpload(input: {
  data: Buffer;
  declaredMime: string;
  allowedMimes: readonly string[];
  maxBytes: number;
}): { sha256: string; contentType: string } {
  if (input.data.length === 0) {
    throw new AppError('FILE_REJECTED', 'The uploaded file is empty');
  }
  if (input.data.length > input.maxBytes) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'The file exceeds the maximum allowed size', {
      detail: `Maximum is ${Math.floor(input.maxBytes / (1024 * 1024))} MB.`,
    });
  }

  // The real type is whatever the bytes say, not what the client declared.
  let detectedMime: string | null = null;
  for (const type of ALLOWED) {
    if (type.signatures.some((sig) => matchesSignature(input.data, sig))) {
      detectedMime = type.mime;
      break;
    }
  }
  if (!detectedMime && isHeic(input.data)) detectedMime = 'image/heic';

  if (!detectedMime) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'File type not recognised', {
      detail: 'Only PDF, JPG, PNG and HEIC files are accepted.',
    });
  }

  if (!input.allowedMimes.includes(detectedMime)) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', `${detectedMime} is not an accepted file type`);
  }

  // A declared type that contradicts the bytes is suspicious, not fatal (jpeg vs
  // jpg naming, HEIC re-encodings), but it is worth refusing an obvious mismatch.
  if (
    input.declaredMime &&
    input.declaredMime !== detectedMime &&
    !(input.declaredMime === 'image/jpg' && detectedMime === 'image/jpeg')
  ) {
    // Trust the bytes, keep the detected type; the mismatch is not by itself a
    // rejection because clients are unreliable about MIME types.
  }

  const sha256 = createHash('sha256').update(input.data).digest('hex');
  return { sha256, contentType: detectedMime };
}
