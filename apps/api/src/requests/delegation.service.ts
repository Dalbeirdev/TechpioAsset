import { Injectable } from '@nestjs/common';
import type { AuthUser, CreateDelegationInput } from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * v2.2 Workstream D — approval delegations. A user delegates their approval
 * authority to another user for an optional window. The decide path
 * (WorkflowService.assertCanDecide) resolves active delegations and preserves
 * SoD (a delegate can never approve the delegator's own request).
 */
@Injectable()
export class DelegationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actor: AuthUser, input: CreateDelegationInput) {
    if (input.delegateId === actor.id) {
      throw new AppError('VALIDATION_FAILED', 'You cannot delegate approvals to yourself');
    }
    const delegate = await this.prisma.client.user.findFirst({
      where: { id: input.delegateId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!delegate) throw new AppError('NOT_FOUND', 'Delegate not found');

    return this.prisma.client.approvalDelegation.create({
      data: {
        companyId: actor.companyId,
        delegatorId: actor.id,
        delegateId: input.delegateId,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        reason: input.reason ?? null,
      },
    });
  }

  /** Delegations the actor has given and received. */
  async listForUser(actor: AuthUser) {
    const [given, received] = await Promise.all([
      this.prisma.client.approvalDelegation.findMany({
        where: { delegatorId: actor.id, revokedAt: null },
        include: {
          delegate: {
            select: {
              id: true,
              email: true,
              // Identity only - never the full profile row (phone, employee
              // number, hire date...): naming someone as a delegate must not
              // become a way to read their HR record (v2.12 audit, G2).
              profile: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.approvalDelegation.findMany({
        where: { delegateId: actor.id, revokedAt: null },
        include: {
          delegator: {
            select: {
              id: true,
              email: true,
              profile: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { given, received };
  }

  /** Revoke a delegation the actor created (soft revoke). */
  async revoke(actor: AuthUser, id: string) {
    const existing = await this.prisma.client.approvalDelegation.findFirst({
      where: { id, delegatorId: actor.id, revokedAt: null },
      select: { id: true },
    });
    if (!existing) throw new AppError('NOT_FOUND', 'Delegation not found');
    return this.prisma.client.approvalDelegation.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }
}
