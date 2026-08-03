import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import type { Request } from 'express';
import { TokenService } from '../../auth/token.service.js';

/**
 * v2.8 S5 — rate limiting per TENANT rather than per IP.
 *
 * The global bucket was fine when there was one tenant. Now that the platform
 * plane provisions them, one busy (or misbehaving) tenant sharing an egress IP
 * — or simply generating a lot of legitimate traffic — could exhaust the
 * limit for everybody else. Each tenant now gets its own bucket.
 *
 * Two details that matter:
 *
 * 1. **The token is VERIFIED, not merely decoded.** Bucketing on an unverified
 *    `companyId` claim would let an attacker forge another tenant's id and
 *    exhaust *their* bucket — turning a protection into a weapon. A signature
 *    check is cheap (HMAC) and happens again properly in JwtAuthGuard.
 * 2. **Unauthenticated traffic still buckets by IP.** The throttler runs
 *    before authentication on purpose, so an unauthenticated flood stays cheap
 *    to reject; anonymous callers simply have no tenant to key on.
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly tokens: TokenService,
  ) {
    super(options, storageService, reflector);
  }

  protected override async getTracker(req: Request): Promise<string> {
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Bearer ')) {
      try {
        const claims = await this.tokens.verifyAccessToken(header.slice('Bearer '.length).trim());
        if (claims.companyId) return `tenant:${claims.companyId}`;
      } catch {
        // An invalid or expired token is not a tenant. Fall through to the IP
        // bucket so the caller is still limited - never unlimited.
      }
    }
    return `ip:${req.ip ?? 'unknown'}`;
  }
}
