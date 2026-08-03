import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ScimPrincipal {
  companyId: string;
  /** The admin who minted the token — SCIM writes act as them, honestly audited. */
  actorUserId: string | null;
}

/**
 * v2.6 A3 — bearer-token auth for the SCIM endpoints. IdPs cannot do the JWT
 * dance; they present the long-lived token minted in the integrations hub.
 * Only the SHA-256 hash is stored; a stolen database does not leak the token.
 */
@Injectable()
export class ScimGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined>; scim?: ScimPrincipal }>();
    const header = request.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new UnauthorizedException('SCIM requests need a bearer token');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const record = await this.prisma.client.scimToken.findFirst({ where: { tokenHash } });
    if (!record) throw new UnauthorizedException('Unknown SCIM token');

    await this.prisma.client.scimToken.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    request.scim = { companyId: record.companyId, actorUserId: record.createdById };
    return true;
  }
}
