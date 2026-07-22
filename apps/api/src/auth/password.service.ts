import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { ARGON2_PARAMS } from './argon2-params.js';

/** Password hashing. See ARGON2_PARAMS for the parameter choice. */
@Injectable()
export class PasswordService {
  private readonly options = ARGON2_PARAMS;

  hash(plain: string): Promise<string> {
    return hash(plain, this.options);
  }

  /**
   * Returns false rather than throwing on a malformed hash. A user row with a
   * null or corrupt hash (SSO-only, or mid-migration) must fail closed as a
   * normal authentication failure, not a 500 that distinguishes it from a wrong
   * password.
   */
  async verify(hashed: string | null | undefined, plain: string): Promise<boolean> {
    if (!hashed) return false;
    try {
      return await verify(hashed, plain, this.options);
    } catch {
      return false;
    }
  }
}
