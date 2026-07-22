import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../common/errors/app-error.js';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AccessTokenClaims {
  sub: string;
  companyId: string;
  /** Permission keys, resolved at issue time. */
  perms: string[];
  scope: string;
  jti: string;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** Parses "15m" / "30d" / "3600" into seconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[match[2] ?? 's'] ?? 1;
  return amount * multiplier;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  get accessTtlSeconds(): number {
    return parseDuration(this.config.get('JWT_ACCESS_TTL'));
  }

  get refreshTtlSeconds(): number {
    return parseDuration(this.config.get('JWT_REFRESH_TTL'));
  }

  /** Refresh tokens are opaque random strings, not JWTs - only their hash is stored. */
  private static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(input: {
    userId: string;
    companyId: string;
    permissions: string[];
    scope: string;
    familyId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync(
      {
        sub: input.userId,
        companyId: input.companyId,
        perms: input.permissions,
        scope: input.scope,
        jti: randomUUID(),
      } satisfies AccessTokenClaims,
      {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: this.accessTtlSeconds,
      },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlSeconds * 1000);

    await this.prisma.client.refreshToken.create({
      data: {
        userId: input.userId,
        tokenHash: TokenService.hashToken(refreshToken),
        familyId: input.familyId ?? randomUUID(),
        expiresAt: refreshExpiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });

    return { accessToken, expiresIn: this.accessTtlSeconds, refreshToken, refreshExpiresAt };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      return await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });
    } catch (error) {
      const expired = (error as Error).name === 'TokenExpiredError';
      throw new AppError(
        expired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED',
        expired ? 'Access token has expired' : 'Invalid access token',
      );
    }
  }

  /**
   * Rotation with reuse detection.
   *
   * Each refresh consumes its token and issues a new one in the same family. If a
   * token that has already been rotated is presented again, the entire family is
   * revoked: either it was stolen and replayed, or the legitimate client is
   * replaying, and neither case should keep a live session. This is the standard
   * mitigation for refresh-token theft, which is otherwise undetectable.
   */
  async rotate(presentedToken: string, context: { ipAddress?: string; userAgent?: string }) {
    const tokenHash = TokenService.hashToken(presentedToken);
    const existing = await this.prisma.client.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) {
      throw new AppError('UNAUTHENTICATED', 'Invalid refresh token');
    }

    if (existing.rotatedAt || existing.revokedAt) {
      this.logger.warn(
        `Refresh token reuse detected for user ${existing.userId}; revoking family ${existing.familyId}`,
      );
      await this.revokeFamily(existing.familyId, 'REUSE_DETECTED');
      throw new AppError('UNAUTHENTICATED', 'Refresh token has already been used');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new AppError('TOKEN_EXPIRED', 'Refresh token has expired');
    }

    await this.prisma.client.refreshToken.update({
      where: { id: existing.id },
      data: { rotatedAt: new Date() },
    });

    return { record: existing, familyId: existing.familyId, context };
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.client.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Secure logout: revokes the presented token's whole family, not just that token. */
  async revokeByToken(presentedToken: string, reason = 'LOGOUT'): Promise<void> {
    const record = await this.prisma.client.refreshToken.findUnique({
      where: { tokenHash: TokenService.hashToken(presentedToken) },
    });
    if (record) await this.revokeFamily(record.familyId, reason);
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.prisma.client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
