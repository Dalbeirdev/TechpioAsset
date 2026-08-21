import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { assetScopeFilter, tenantFilter } from '../common/scope.js';
import { awaitingMeFilter } from '../requests/awaiting-me.js';

/** A single KPI tile. The frontend maps `icon` (Lucide) + `tone` to styling. */
export interface DashboardTile {
  key: string;
  label: string;
  value: number;
  href: string;
  icon: string;
  tone: 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';
}

const OPEN_REQUEST_STATUSES = ['APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'] as const;
const OPEN_MAINTENANCE = ['REQUESTED', 'SCHEDULED', 'IN_PROGRESS'] as const;
const RETIRED_STATUSES = ['DISPOSED', 'DONATED', 'RETIRED'] as const;

/**
 * v2.2 Workstream F — the "what needs me now" dashboard summary.
 *
 * Tiles are computed server-side, gated by the actor's permissions and narrowed
 * by their data scope, so each role is shown only what it may see: an Employee
 * (scope OWN, no approve/maintenance rights) gets their own assets and requests;
 * a manager or IT lead additionally gets the estate, approvals and maintenance.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(actor: AuthUser): Promise<{ tiles: DashboardTile[] }> {
    const has = (permission: string): boolean => actor.permissions.includes(permission);
    const tenant = tenantFilter(actor);
    const db = this.prisma.client;
    const tiles: DashboardTile[] = [];

    // Everyone: their own kit and their own requests. Counted in parallel -
    // these tiles do not depend on each other, and awaiting them in turn made
    // the dashboard as slow as the sum of its parts.
    const [myAssets, myOpenRequests] = await Promise.all([
      db.asset.count({ where: { ...tenant, assignedUserId: actor.id, deletedAt: null } }),
      db.assetRequest.count({
        where: { ...tenant, requesterId: actor.id, status: { notIn: [...OPEN_REQUEST_STATUSES] } },
      }),
    ]);
    tiles.push({
      key: 'my-assets',
      label: 'My assets',
      value: myAssets,
      href: '/my-assets',
      icon: 'Boxes',
      tone: 'info',
    });
    tiles.push({
      key: 'my-open-requests',
      label: 'My open requests',
      value: myOpenRequests,
      href: '/requests',
      icon: 'ClipboardList',
      tone: 'progress',
    });

    // Approvers: what is waiting on them right now.
    if (has(PERMISSIONS.REQUESTS_APPROVE)) {
      // The same predicate the inbox uses. It counted only `approverId` before,
      // which a role-based step does not carry until it is decided - so this
      // tile read 0 for an approver with a full inbox, while linking to the
      // list that showed them.
      const awaiting = await db.assetRequest.count({
        where: { ...tenant, ...awaitingMeFilter(actor) },
      });
      tiles.push({
        key: 'awaiting-approval',
        label: 'Awaiting my approval',
        value: awaiting,
        href: '/requests?awaitingMe=true',
        icon: 'UserCheck',
        tone: awaiting > 0 ? 'warning' : 'neutral',
      });
    }

    // Roles that see beyond their own kit: the estate + warranty risk.
    if (has(PERMISSIONS.ASSETS_READ) && actor.scope !== 'OWN') {
      const scope = assetScopeFilter(actor);
      tiles.push({
        key: 'assets-total',
        label: 'Assets',
        value: await db.asset.count({ where: { ...scope, deletedAt: null } }),
        href: '/assets',
        icon: 'Layers',
        tone: 'info',
      });
      const soon = new Date(Date.now() + 90 * 86_400_000);
      tiles.push({
        key: 'warranty-expiring',
        label: 'Warranty expiring (90d)',
        value: await db.asset.count({
          where: {
            ...scope,
            deletedAt: null,
            warrantyEndDate: { gte: new Date(), lte: soon },
            status: { notIn: [...RETIRED_STATUSES] },
          },
        }),
        href: '/assets',
        icon: 'ShieldAlert',
        tone: 'warning',
      });
    }

    // Licence owners — renewals to plan (v2.3).
    if (has(PERMISSIONS.LICENSES_READ)) {
      const in90d = new Date(Date.now() + 90 * 86_400_000);
      const expiring = await db.softwareLicense.count({
        where: {
          companyId: actor.companyId,
          status: { not: 'RETIRED' },
          expiryDate: { gte: new Date(), lte: in90d },
        },
      });
      tiles.push({
        key: 'licenses-expiring',
        label: 'Licenses expiring (90d)',
        value: expiring,
        href: '/licenses',
        icon: 'KeyRound',
        tone: expiring > 0 ? 'warning' : 'neutral',
      });

      // v2.7 R4 — pools at or near capacity. A licence that is full today is
      // tomorrow's blocked hire, so it earns its own tile rather than being
      // discovered at the moment of refusal.
      const pools = await db.seatPool.findMany({
        where: { companyId: actor.companyId, license: { status: { not: 'RETIRED' } } },
        select: { seatsAllocated: true, seatsReserved: true },
      });
      const strained = pools.filter(
        (p) => p.seatsAllocated > 0 && p.seatsReserved / p.seatsAllocated >= 0.9,
      );
      const full = strained.filter((p) => p.seatsReserved >= p.seatsAllocated).length;
      tiles.push({
        key: 'licenses-at-capacity',
        label: full > 0 ? `Licenses full (${full}) or near` : 'Licenses near capacity',
        value: strained.length,
        href: '/licenses',
        icon: 'KeyRound',
        tone: full > 0 ? 'danger' : strained.length > 0 ? 'warning' : 'neutral',
      });
    }

    // Maintenance owners.
    if (has(PERMISSIONS.MAINTENANCE_READ)) {
      tiles.push({
        key: 'open-maintenance',
        label: 'Open maintenance',
        value: await db.maintenanceRecord.count({
          where: { asset: { companyId: actor.companyId }, status: { in: [...OPEN_MAINTENANCE] } },
        }),
        href: '/maintenance',
        icon: 'Wrench',
        tone: 'progress',
      });
    }

    return { tiles };
  }
}
