import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Licence keys at rest — AES-256-GCM with a key derived from LICENSE_KEY_SECRET.
 * Ciphertext layout: base64(iv[12] | authTag[16] | data). The API only ever
 * serves the masked form; decryption happens solely on an audited reveal.
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encryptLicenseKey(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptLicenseKey(ciphertext: string, secret: string): string {
  const raw = Buffer.from(ciphertext, 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const data = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** "XXXX-…-AB12" — enough to recognise a key, never enough to use it. */
export function maskLicenseKey(last4: string): string {
  return `••••-••••-${last4}`;
}
