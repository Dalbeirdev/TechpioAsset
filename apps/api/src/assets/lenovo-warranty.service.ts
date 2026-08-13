import { Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import { detectWarrantyVendor } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Zero-touch Lenovo warranty lookup (v2.16).
 *
 * Lenovo's support service answers a plain JSON request with the machine's
 * entitlements — verified against this fleet's real serials before this was
 * built. That makes Lenovo the one manufacturer we can update *automatically*:
 * a click on the asset, and a nightly sweep for the whole fleet. Dell gets the
 * same treatment once TechDirect credentials exist; HP and Acer publish no
 * service at all, so they stay on the paste-and-extract flow.
 *
 * The endpoint is public but UNOFFICIAL - Lenovo can change it without notice.
 * Every failure is therefore loud (thrown upward or counted in the sweep
 * summary), never a silently-kept stale date.
 */

const LENOVO_IBASE_URL = 'https://pcsupport.lenovo.com/us/en/api/v4/upsell/redport/getIbaseInfo';
const LOOKUP_TIMEOUT_MS = 20_000;
/** Politeness gap between serial lookups in the nightly sweep. */
const SWEEP_DELAY_MS = 750;
const SWEEP_BATCH = 500;

interface LenovoEntitlement {
  name?: string;
  startDate?: string;
  endDate?: string;
}

export interface LenovoWarrantyResult {
  productName: string | null;
  warrantyName: string | null;
  warrantyStartDate: string | null;
  warrantyEndDate: string | null;
  /** Lenovo's own words, e.g. "In warranty" / "Out of warranty". */
  status: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class LenovoWarrantyService {
  private readonly logger = new Logger(LenovoWarrantyService.name);

  /** Swappable in tests so no test ever calls Lenovo for real. */
  fetchImpl: typeof fetch = (...args) => fetch(...args);
  /** Politeness gap between lookups; tests set it to zero. */
  sweepDelayMs = SWEEP_DELAY_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Asks Lenovo about one serial. Agents often report the BIOS identity string
   * ("1S" + machine type/model + serial) rather than the bare 8-character
   * serial Lenovo indexes by, so an unknown long "1S…" value gets one retry
   * with its last 8 characters — verified against this fleet's real devices.
   */
  async lookup(serial: string): Promise<LenovoWarrantyResult> {
    try {
      return await this.lookupOne(serial);
    } catch (error) {
      const derived = serial.trim().toUpperCase();
      if (
        error instanceof AppError &&
        error.code === 'NOT_FOUND' &&
        derived.startsWith('1S') &&
        derived.length > 10
      ) {
        return this.lookupOne(derived.slice(-8));
      }
      throw error;
    }
  }

  private async lookupOne(serial: string): Promise<LenovoWarrantyResult> {
    let payload: {
      code?: number;
      data?: {
        machineInfo?: { productName?: string };
        currentWarranty?: LenovoEntitlement;
        baseWarranties?: LenovoEntitlement[];
        upgradeWarranties?: LenovoEntitlement[];
        contractWarranties?: LenovoEntitlement[];
        warrantyStatus?: string;
      } | null;
    };
    try {
      const res = await this.fetchImpl(LENOVO_IBASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        },
        body: JSON.stringify({ serialNumber: serial }),
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`Lenovo responded ${res.status}`);
      }
      payload = (await res.json()) as typeof payload;
    } catch (error) {
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Lenovo warranty service did not answer', {
        detail: 'Try again in a few minutes; the date can always be set manually meanwhile.',
        cause: error,
      });
    }

    if (payload.code !== 0 || !payload.data) {
      throw new AppError('NOT_FOUND', 'Lenovo does not recognise this serial number', {
        detail:
          'Check the serial on the sticker under the device; the record may hold a placeholder.',
      });
    }

    const d = payload.data;
    const entitlements = [
      ...(d.baseWarranties ?? []),
      ...(d.upgradeWarranties ?? []),
      ...(d.contractWarranties ?? []),
    ].filter((w) => typeof w.endDate === 'string' && ISO_DATE.test(w.endDate));

    // Lenovo names the governing entitlement in currentWarranty; the furthest
    // endDate across all entitlements is the real coverage end either way.
    const latest = entitlements.reduce<LenovoEntitlement | null>(
      (best, w) => (!best || w.endDate! > best.endDate! ? w : best),
      null,
    );
    const current =
      d.currentWarranty && ISO_DATE.test(d.currentWarranty.endDate ?? '') ? d.currentWarranty : null;
    const winner = current && (!latest || current.endDate! >= latest.endDate!) ? current : latest;

    const starts = entitlements
      .map((w) => w.startDate)
      .filter((s): s is string => typeof s === 'string' && ISO_DATE.test(s))
      .sort();

    return {
      productName: d.machineInfo?.productName ?? null,
      warrantyName: winner?.name ?? null,
      warrantyStartDate: starts[0] ?? null,
      warrantyEndDate: winner?.endDate ?? null,
      status: d.warrantyStatus ?? null,
    };
  }

  /**
   * One-click refresh from the asset page: looks the device up at Lenovo and
   * records what came back, with a normal asset-update audit entry.
   */
  async refreshAsset(actor: AuthUser, id: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, companyId: actor.companyId },
      select: {
        id: true,
        companyId: true,
        assetTag: true,
        serialNumber: true,
        brand: true,
        model: true,
        name: true,
        warrantyStartDate: true,
        warrantyEndDate: true,
        hardwareProfile: { select: { manufacturer: true } },
      },
    });
    if (!asset) throw AppError.notFound('Asset', id);

    const vendor = detectWarrantyVendor(
      asset.hardwareProfile?.manufacturer,
      asset.brand,
      asset.model,
      asset.name,
    );
    if (vendor?.vendor !== 'lenovo') {
      throw new AppError('CONFLICT', 'Automatic lookup is available for Lenovo devices only', {
        detail:
          'Dell becomes automatic once TechDirect credentials are configured; HP and Acer publish no lookup service, so use the paste flow.',
      });
    }
    if (!asset.serialNumber) {
      throw new AppError('CONFLICT', 'This asset has no serial number to look up', {
        detail: 'Record the serial from the sticker on the device first.',
      });
    }

    const result = await this.lookup(asset.serialNumber);
    const applied = await this.apply(asset, result, actor.id);
    return { ...result, applied };
  }

  /**
   * Nightly zero-touch pass: every Lenovo device with a serial gets its
   * warranty dates refreshed from Lenovo. Returns a summary and logs it —
   * an unofficial endpoint gets no silent failures.
   */
  async sweep(scope?: {
    assetIds?: string[];
  }): Promise<{ checked: number; updated: number; failed: number }> {
    const candidates = await this.prisma.client.asset.findMany({
      where: {
        deletedAt: null,
        serialNumber: { not: null },
        status: { notIn: ['DISPOSED', 'DONATED', 'RETIRED'] },
        ...(scope?.assetIds ? { id: { in: scope.assetIds } } : {}),
      },
      select: {
        id: true,
        companyId: true,
        assetTag: true,
        serialNumber: true,
        brand: true,
        model: true,
        name: true,
        warrantyStartDate: true,
        warrantyEndDate: true,
        hardwareProfile: { select: { manufacturer: true } },
      },
      take: SWEEP_BATCH,
    });

    const lenovo = candidates.filter(
      (a) =>
        detectWarrantyVendor(a.hardwareProfile?.manufacturer, a.brand, a.model, a.name)?.vendor ===
        'lenovo',
    );

    let updated = 0;
    let failed = 0;
    for (const asset of lenovo) {
      try {
        const result = await this.lookup(asset.serialNumber!);
        if (await this.apply(asset, result, null)) updated += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Lenovo lookup failed for ${asset.assetTag} (${asset.serialNumber}): ${(error as Error).message}`,
        );
      }
      await new Promise((r) => setTimeout(r, this.sweepDelayMs));
    }

    this.logger.log(
      `Lenovo warranty sweep: ${lenovo.length} checked, ${updated} updated, ${failed} failed`,
    );
    return { checked: lenovo.length, updated, failed };
  }

  /** Writes the dates when they differ; audited as a normal asset update. */
  private async apply(
    asset: {
      id: string;
      companyId: string;
      warrantyStartDate: Date | null;
      warrantyEndDate: Date | null;
    },
    result: LenovoWarrantyResult,
    actorId: string | null,
  ): Promise<boolean> {
    if (!result.warrantyEndDate) return false;
    const nextEnd = new Date(`${result.warrantyEndDate}T00:00:00.000Z`);
    const nextStart = result.warrantyStartDate
      ? new Date(`${result.warrantyStartDate}T00:00:00.000Z`)
      : null;

    const sameEnd = asset.warrantyEndDate?.getTime() === nextEnd.getTime();
    const sameStart =
      (asset.warrantyStartDate?.getTime() ?? null) === (nextStart?.getTime() ?? null);
    if (sameEnd && sameStart) return false;

    await this.prisma.client.asset.update({
      where: { id: asset.id },
      data: {
        warrantyEndDate: nextEnd,
        ...(nextStart ? { warrantyStartDate: nextStart } : {}),
      },
    });
    await this.audit.record({
      companyId: asset.companyId,
      actorId,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'Asset',
      entityId: asset.id,
      previousValues: {
        warrantyEndDate: asset.warrantyEndDate?.toISOString() ?? null,
        warrantyStartDate: asset.warrantyStartDate?.toISOString() ?? null,
      },
      newValues: {
        warrantyEndDate: nextEnd.toISOString(),
        warrantyStartDate: (nextStart ?? asset.warrantyStartDate)?.toISOString() ?? null,
        source: 'lenovo-warranty-lookup',
        warrantyName: result.warrantyName,
      },
    });
    return true;
  }
}
