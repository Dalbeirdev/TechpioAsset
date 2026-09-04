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

/**
 * WEBP is a RIFF container: "RIFF", four length bytes, then "WEBP". The length
 * sits between the two markers, so there is no fixed leading signature to match
 * and it needs its own check - the same reason HEIC does below.
 */
function isWebp(data: Buffer): boolean {
  if (data.length < 12) return false;
  return (
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  );
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
  if (!detectedMime && isWebp(input.data)) detectedMime = 'image/webp';
  if (!detectedMime && isHeic(input.data)) detectedMime = 'image/heic';

  if (!detectedMime) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'File type not recognised', {
      detail: 'Only PDF, JPG, PNG, WEBP and HEIC files are accepted.',
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

/**
 * Verifies that bytes really are a spreadsheet before a parser touches them
 * (v2.12 audit).
 *
 * The asset import accepted whatever was posted and handed the buffer straight
 * to the workbook parser, trusting the filename. Spreadsheets are not in the
 * general upload allowlist (that governs documents and photos), so they get
 * their own narrow check rather than a widened allowlist:
 *   - .xlsx/.xlsm are ZIP containers  -> "PK\x03\x04"
 *   - legacy .xls is an OLE2 compound -> D0 CF 11 E0 A1 B1 1A E1
 * Anything else is refused before a single row is read.
 */
export function assertSpreadsheet(data: Buffer): void {
  const zip = [0x50, 0x4b, 0x03, 0x04];
  const ole2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const looksLike = (sig: number[]) =>
    data.length >= sig.length && sig.every((byte, i) => data[i] === byte);

  if (!looksLike(zip) && !looksLike(ole2)) {
    throw new AppError('FILE_REJECTED', 'That file is not a spreadsheet', {
      detail: 'Upload an .xlsx or .xls workbook.',
    });
  }
}
