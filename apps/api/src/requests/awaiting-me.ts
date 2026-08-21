import { Prisma, ApprovalDecision } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';

/**
 * "Is this request waiting on me?" - one definition (v2.26).
 *
 * There were two, and they disagreed. The requests list resolved all four ways
 * a step can point at somebody, while the dashboard tile counted only the first
 * - `approverId: actor.id`. But a role-based step carries no approverId at all
 * until it is decided; it names a role and the holder is resolved at read time.
 * So the tile counted almost nothing: an Office Administrator with five
 * requests sitting in their inbox saw "Awaiting my approval: 0" on the
 * dashboard, on a tile linking to the very list that showed all five.
 *
 * Exported as a predicate rather than duplicated so the two cannot drift again.
 */
export function awaitingMeFilter(actor: AuthUser): Prisma.AssetRequestWhereInput {
  return {
    approvals: {
      some: {
        decision: ApprovalDecision.PENDING,
        OR: [
          // Named approver.
          { approverId: actor.id },
          // Role-based step: anyone currently holding the role.
          { approverRole: { users: { some: { userId: actor.id } } } },
          // Line-manager step carries neither an approverId nor a role - the
          // approver is whoever manages the beneficiary - so it is matched
          // through the request's denormalised managerId. Without this branch,
          // manager approvals never appear in an inbox and simply stall.
          { approverType: 'LINE_MANAGER', request: { managerId: actor.id } },
          // v2.24 - no manager recorded: the Manager role stands in, so those
          // requests land in every Manager-role holder's inbox.
          ...(actor.roles.includes('MANAGER')
            ? [
                {
                  approverType: 'LINE_MANAGER' as const,
                  request: { managerId: null, requesterId: { not: actor.id } },
                },
              ]
            : []),
        ],
      },
    },
  };
}
