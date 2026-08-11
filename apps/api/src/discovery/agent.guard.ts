import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The identity an enrolled laptop reports under. Deliberately NOT an AuthUser:
 * an agent is not a person, holds no permissions, and can reach exactly one
 * endpoint.
 */
export interface AgentPrincipal {
  companyId: string;
  deviceAgentId: string;
  machineId: string;
}

/**
 * v2.13 — bearer auth for the inventory agent.
 *
 * The whole point of this guard is what it refuses to be: agents are installed
 * on hundreds of laptops that walk out of the building, so shipping an
 * administrator's credential with them would put estate-wide read/write on
 * every desk. A device credential is minted per machine at enrolment, is
 * accepted only here, and carries no permissions at all — the report endpoint
 * pins the payload to `machineId`, so a stolen agent token can overwrite one
 * laptop's own inventory and nothing else.
 *
 * Revocation is a column, not a deletion: unenrolling a laptop leaves the row
 * (and its history) while the credential stops working immediately.
 */
@Injectable()
export class AgentGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined>; agent?: AgentPrincipal }>();
    const header = request.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new UnauthorizedException('The agent must present its device credential');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const device = await this.prisma.client.deviceAgent.findUnique({
      where: { tokenHash },
      select: { id: true, companyId: true, machineId: true, revokedAt: true },
    });
    // One message for "unknown" and "revoked" alike: a revoked agent must not
    // learn that its credential was ever valid.
    if (!device || device.revokedAt) throw new UnauthorizedException('Unknown device credential');

    await this.prisma.client.deviceAgent.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    request.agent = {
      companyId: device.companyId,
      deviceAgentId: device.id,
      machineId: device.machineId,
    };
    return true;
  }
}
