import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { assetScopeFilter, tenantFilter } from '../common/scope.js';

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

    // Everyone: their own kit and their own requests.
    tiles.push({
      key: 'my-assets',
      label: 'My assets',
      value: await db.asset.count({
        where: { ...tenant, assignedUserId: actor.id, deletedAt: null },
      }),
      href: '/my-assets',
      icon: 'Boxes',
      tone: 'info',
    });
    tiles.push({
      key: 'my-open-requests',
      label: 'My open requests',
      value: await db.assetRequest.count({
        where: { ...tenant, requesterId: actor.id, status: { notIn: [...OPEN_REQUEST_STATUSES] } },
      }),
      href: '/requests',
      icon: 'ClipboardList',
      tone: 'progress',
    });

    // Approvers: what is waiting on them right now.
    if (has(PERMISSIONS.REQUESTS_APPROVE)) {
      const awaiting = await db.assetRequest.count({
        where: { ...tenant, approvals: { some: { decision: 'PENDING', approverId: actor.id } } },
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
