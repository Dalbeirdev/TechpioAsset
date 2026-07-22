import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as OTPAuth from 'otpauth';
import { AppConfig } from '../config/config.module.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * TOTP multi-factor authentication (spec section 1).
 *
 * The shared secret is encrypted at rest with AES-256-GCM before it touches the
 * database. A TOTP secret is a password equivalent: anyone reading the column in
 * a backup or a leaked dump could mint valid codes indefinitely, so storing it in
 * plaintext would make MFA decorative.
 */
@Injectable()
export class MfaService {
  private readonly key: Buffer;

  constructor(private readonly config: AppConfig) {
    // The configured key is arbitrary-length text; derive a fixed 32 bytes.
    this.key = createHash('sha256').update(this.config.get('MFA_ENCRYPTION_KEY')).digest();
  }

  generateSecret(): string {
    return new OTPAuth.Secret({ size: 20 }).base32;
  }

  buildOtpauthUrl(email: string, secret: string): string {
    return new OTPAuth.TOTP({
      issuer: 'TechpioAsset',
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    }).toString();
  }

  /**
   * Validates a code with a ±1 period window, tolerating modest clock skew
   * between the server and the user's device without widening the window enough
   * to matter for replay.
   */
  verifyCode(secret: string, code: string): boolean {
    const totp = new OTPAuth.TOTP({
      issuer: 'TechpioAsset',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    return totp.validate({ token: code, window: 1 }) !== null;
  }

  encryptSecret(secret: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }

  /** Returns null on any failure; a tampered or key-rotated secret must not throw. */
  decryptSecret(stored: string | null | undefined): string | null {
    if (!stored) return null;
    try {
      const raw = Buffer.from(stored, 'base64');
      const iv = raw.subarray(0, IV_LENGTH);
      const tag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const data = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
