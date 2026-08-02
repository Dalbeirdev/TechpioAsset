import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeHealth, type HealthInputs, type HealthResult } from '@techpioasset/domain';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * v2.5 H4 — the health cache around the pure B.7 engine (plan invariant 2:
 * health is DERIVED, never stored authoritatively; the cache exists so lists
 * and dashboards do not recompute, and computedAt says how stale it is).
 *
 * Mapping gaps between what agents report and what B.7 scores are filled here,
 * deterministically, so the domain stays the pure contract:
 * - Storage: an absent SMART status counts as HEALTHY when free space IS known
 *   (absence of a warning, not evidence of health); absent free space scores
 *   as 100% free (no penalty for the unreported). Neither known -> excluded.
 * - Security: included only when disk encryption is known (the flagship
 *   signal). Unreported controls default to fine — the score punishes reported
 *   problems, it does not fabricate unreported ones.
 * - Updates: included when either patch count or support status is known.
 * - Memory baseline comes from HEALTH_RAM_BASELINE_GB (default 8).
 * An asset with no discovered data at all has NO health row — never a number.
 */
@Injectable()
export class AssetHealthService {
  private readonly logger = new Logger(AssetHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Recompute one asset's health; upserts (or clears) the cache row. */
  async recomputeForAsset(
    companyId: string,
    assetId: string,
    now: Date = new Date(),
  ): Promise<HealthResult | null> {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: assetId, companyId, deletedAt: null },
      select: {
        warrantyEndDate: true,
        hardwareProfile: true,
        osInfo: true,
      },
    });
    if (!asset) return null;

    const result = computeHealth(this.buildInputs(asset, now));
    if (!result) {
      // Nothing known: no score, no lie. Clear any stale cache row.
      await this.prisma.client.assetHealth.deleteMany({ where: { assetId } });
      return null;
    }

    const data = {
      overall: result.overall,
      grade: result.grade,
      subScores: result.subScores as unknown as Prisma.InputJsonValue,
      recommendations: result.recommendations as unknown as Prisma.InputJsonValue,
      capped: result.capped,
      computedAt: now,
    };
    await this.prisma.client.assetHealth.upsert({
      where: { assetId },
      create: { companyId, assetId, ...data },
      update: data,
    });
    return result;
  }

  /** Recompute every asset that has any discovered data. Returns the count. */
  async recomputeAll(now: Date = new Date()): Promise<number> {
    const assets = await this.prisma.client.asset.findMany({
      where: {
        deletedAt: null,
        OR: [{ hardwareProfile: { isNot: null } }, { osInfo: { isNot: null } }],
      },
      select: { id: true, companyId: true },
    });
    for (const asset of assets) {
      await this.recomputeForAsset(asset.companyId, asset.id, now);
    }
    if (assets.length > 0) this.logger.log(`Health recomputed for ${assets.length} asset(s)`);
    return assets.length;
  }

  private buildInputs(
    asset: {
      warrantyEndDate: Date | null;
      hardwareProfile: {
        batteryHealthPct: number | null;
        batteryCycleCount: number | null;
        smartStatus: 'HEALTHY' | 'WARNING' | 'FAILING' | null;
        storageTotalGb: Prisma.Decimal | null;
        storageFreeGb: Prisma.Decimal | null;
        ramGb: Prisma.Decimal | null;
      } | null;
      osInfo: {
        diskEncrypted: boolean | null;
        defenderEnabled: boolean | null;
        firewallEnabled: boolean | null;
        tpmPresent: boolean | null;
        osActivated: boolean | null;
        localAdminCount: number | null;
        missingCriticalPatches: number | null;
        osSupported: boolean | null;
      } | null;
    },
    now: Date,
  ): HealthInputs {
    const hw = asset.hardwareProfile;
    const os = asset.osInfo;
    const inputs: HealthInputs = {};

    if (hw?.batteryHealthPct != null) {
      inputs.battery = {
        healthPct: hw.batteryHealthPct,
        cycleCount: hw.batteryCycleCount ?? 0,
      };
    }

    const freePct =
      hw?.storageTotalGb && hw.storageFreeGb && Number(hw.storageTotalGb) > 0
        ? (Number(hw.storageFreeGb) / Number(hw.storageTotalGb)) * 100
        : null;
    if (hw?.smartStatus != null || freePct != null) {
      inputs.storage = { smart: hw?.smartStatus ?? 'HEALTHY', freePct: freePct ?? 100 };
    }

    if (hw?.ramGb != null) {
      inputs.memory = {
        ramGb: Number(hw.ramGb),
        baselineGb: this.config.get('HEALTH_RAM_BASELINE_GB'),
      };
    }

    // Warranty joins the score only once discovery knows the machine at all —
    // otherwise every undiscovered asset would carry a warranty-only "health".
    if (hw || os) {
      inputs.warranty = {
        daysRemaining: asset.warrantyEndDate
          ? Math.floor((asset.warrantyEndDate.getTime() - now.getTime()) / 86_400_000)
          : null,
      };
    }

    if (os?.diskEncrypted != null) {
      inputs.security = {
        diskEncrypted: os.diskEncrypted,
        defenderEnabled: os.defenderEnabled ?? true,
        firewallEnabled: os.firewallEnabled ?? true,
        tpmPresent: os.tpmPresent ?? true,
        osActivated: os.osActivated ?? true,
        localAdminCount: os.localAdminCount ?? 1,
      };
    }

    if (os?.missingCriticalPatches != null || os?.osSupported != null) {
      inputs.updates = {
        missingCriticalPatches: os?.missingCriticalPatches ?? 0,
        osSupported: os?.osSupported ?? true,
      };
    }

    return inputs;
  }
}
