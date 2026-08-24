import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { AuthUser, UpsertAssessmentInput } from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestsService } from './requests.service.js';

/**
 * The commercial assessment of a request (v2.25).
 *
 * An employee states a requirement; somebody authorised states the price. This
 * service owns that second half - the inventory check, the vendor, the
 * arithmetic - and it is the figure recorded here that decides whether Finance
 * reviews the spend.
 *
 * The total is computed on every write and never accepted from the caller. A
 * number that routes a request must not be assertable, or the breakdown becomes
 * decoration sitting next to a total that disagrees with it.
 */
@Injectable()
export class AssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly requests: RequestsService,
  ) {}


  /**
   * Hold the unit that was promised (v2.26).
   *
   * Naming an asset recorded a preference and nothing more: the asset stayed
   * AVAILABLE, so the same laptop could be promised to two people and both
   * requests would close as "filled from existing stock". One of them was
   * always going to be disappointed, and nothing in the system knew.
   *
   * So promising a unit reserves it, promising one already promised is
   * refused, and changing the answer gives it back. Reserved rather than
   * assigned: it is spoken for, but nobody has handed it over yet, and that
   * handover is its own step with its own record.
   */
  private async syncStockReservation(
    actor: AuthUser,
    requestId: string,
    previousAssetId: string | null,
    nextAssetId: string | null,
    fillingFromStock: boolean,
  ): Promise<void> {
    const holding = fillingFromStock ? nextAssetId : null;

    if (previousAssetId && previousAssetId !== holding) {
      // Only ever release something this request is holding.
      await this.prisma.client.asset.updateMany({
        where: { id: previousAssetId, companyId: actor.companyId, status: 'RESERVED' },
        data: { status: 'AVAILABLE' },
      });
    }
    if (!holding) return;

    const asset = await this.prisma.client.asset.findFirst({
      where: { id: holding, companyId: actor.companyId, deletedAt: null },
      select: { id: true, assetTag: true, status: true },
    });
    if (!asset) throw AppError.notFound('Asset', holding);

    // Somebody else's promise on the same unit.
    const claimed = await this.prisma.client.requestAssessment.findFirst({
      where: {
        suitableAssetId: holding,
        requestId: { not: requestId },
        purchaseRequired: false,
        request: { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } },
      },
      select: { request: { select: { requestNumber: true } } },
    });
    if (claimed) {
      // The message is not what reaches the caller - `detail` is - so the unit
      // and the request holding it belong in there, or the reader is told
      // "Conflict" and left to guess which item and whose request.
      throw new AppError(
        'CONFLICT',
        `${asset.assetTag} is already promised to ${claimed.request.requestNumber}`,
        {
          detail:
            `${asset.assetTag} is already promised to ${claimed.request.requestNumber}. ` +
            'Choose a different unit, or clear it from that request first — two requests cannot ' +
            'be filled from the same item.',
        },
      );
    }
    if (asset.status !== 'AVAILABLE' && asset.status !== 'RESERVED') {
      throw new AppError('CONFLICT', `${asset.assetTag} is not free stock`, {
        detail:
          `${asset.assetTag} is ${asset.status.toLowerCase().replace(/_/g, ' ')}, not free stock. ` +
          'Only an available item can be promised against a request.',
      });
    }

    await this.prisma.client.asset.update({
      where: { id: holding },
      data: { status: 'RESERVED' },
    });
  }

  /** (unit price x quantity) + tax + shipping - discount, or null if unpriced. */
  private computeTotal(a: {
    unitPrice: Prisma.Decimal | null;
    quantity: number | null;
    taxAmount: Prisma.Decimal | null;
    shipping: Prisma.Decimal | null;
    discount: Prisma.Decimal | null;
  }): Prisma.Decimal | null {
    // No unit price means nobody has priced it yet - which is not the same as
    // free, and must not read as "under every threshold".
    if (a.unitPrice === null) return null;

    const total = a.unitPrice
      .times(a.quantity ?? 1)
      .plus(a.taxAmount ?? 0)
      .plus(a.shipping ?? 0)
      .minus(a.discount ?? 0);

    // A discount larger than the line cannot make the company money.
    return total.lessThan(0) ? new Prisma.Decimal(0) : total;
  }

  async get(actor: AuthUser, requestId: string) {
    const request = await this.assertRequestVisible(actor, requestId);
    this.assertNotOwnRequest(actor, request);
    const row = await this.prisma.client.requestAssessment.findUnique({
      where: { requestId },
      include: {
        vendor: { select: { id: true, name: true } },
        suitableAsset: { select: { id: true, assetTag: true, name: true } },
        assessedBy: { select: { id: true, profile: { select: { firstName: true, lastName: true } } } },
      },
    });
    return row ? this.present(row) : null;
  }

  async upsert(actor: AuthUser, requestId: string, input: UpsertAssessmentInput) {
    const request = await this.assertRequestVisible(actor, requestId);
    this.assertNotOwnRequest(actor, request);

    /**
     * A refused request is as finished as a cancelled one (v2.27).
     *
     * REJECTED was missing from this list, and it was the expensive omission:
     * every other door closes on rejection - the remaining steps are marked
     * SKIPPED, the decision endpoint answers 409, fulfilment answers 409 - but
     * this one stayed open, so the commercial half of a refused request could
     * still be filled in.
     *
     * Worse than untidy data. Answering "we have one" writes a stock
     * reservation, so a request somebody had already turned down would take a
     * laptop out of AVAILABLE and hold it. Nothing would ever release it,
     * because releasing happens when the request moves on and this one never
     * moves again.
     */
    if (
      request.status === 'COMPLETED' ||
      request.status === 'CANCELLED' ||
      request.status === 'REJECTED'
    ) {
      throw new AppError(
        'ILLEGAL_STATE_TRANSITION',
        `A ${request.status.toLowerCase()} request cannot be assessed`,
        {
          detail:
            'This request was closed before it reached this stage, so there is nothing left to ' +
            'price or fill from stock.',
        },
      );
    }

    // Referenced records must belong to this company: an id from another tenant
    // reads as missing rather than as a permission problem.
    if (input.vendorId) {
      const vendor = await this.prisma.client.vendor.findFirst({
        where: { id: input.vendorId, companyId: actor.companyId },
        select: { id: true },
      });
      if (!vendor) throw AppError.notFound('Vendor', input.vendorId);
    }
    if (input.suitableAssetId) {
      const asset = await this.prisma.client.asset.findFirst({
        where: { id: input.suitableAssetId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!asset) throw AppError.notFound('Asset', input.suitableAssetId);
    }

    const existing = await this.prisma.client.requestAssessment.findUnique({
      where: { requestId },
    });

    const dec = (v: string | null | undefined, fallback: Prisma.Decimal | null) =>
      v === undefined ? fallback : v === null ? null : new Prisma.Decimal(v);
    const pick = <T>(v: T | null | undefined, fallback: T | null): T | null =>
      v === undefined ? fallback : v;

    const merged = {
      inventoryAvailable: pick(input.inventoryAvailable, existing?.inventoryAvailable ?? null),
      suitableAssetId: pick(input.suitableAssetId, existing?.suitableAssetId ?? null),
      purchaseRequired: pick(input.purchaseRequired, existing?.purchaseRequired ?? null),
      suggestedProduct: pick(input.suggestedProduct, existing?.suggestedProduct ?? null),
      vendorId: pick(input.vendorId, existing?.vendorId ?? null),
      unitPrice: dec(input.unitPrice, existing?.unitPrice ?? null),
      quantity: pick(input.quantity, existing?.quantity ?? null),
      taxAmount: dec(input.taxAmount, existing?.taxAmount ?? null),
      shipping: dec(input.shipping, existing?.shipping ?? null),
      discount: dec(input.discount, existing?.discount ?? null),
      notes: pick(input.notes, existing?.notes ?? null),
    };

    // Nothing to spend means nothing to price: recording "filled from stock"
    // and a purchase total together would leave two answers on the record.
    const totalCost =
      merged.purchaseRequired === false ? null : this.computeTotal(merged);

    await this.syncStockReservation(
      actor,
      requestId,
      existing?.suitableAssetId ?? null,
      merged.suitableAssetId,
      merged.purchaseRequired === false,
    );

    const saved = await this.prisma.client.requestAssessment.upsert({
      where: { requestId },
      create: {
        companyId: actor.companyId,
        requestId,
        ...merged,
        totalCost,
        currency: request.currency ?? null,
        assessedById: actor.id,
        assessedAt: new Date(),
      },
      update: {
        ...merged,
        totalCost,
        assessedById: actor.id,
        assessedAt: new Date(),
      },
      include: {
        vendor: { select: { id: true, name: true } },
        suitableAsset: { select: { id: true, assetTag: true, name: true } },
        assessedBy: { select: { id: true, profile: { select: { firstName: true, lastName: true } } } },
      },
    });

    // This is the number that decides whether Finance sees the request, so the
    // trail records who put it there and what it replaced.
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'RequestAssessment',
      entityId: requestId,
      previousValues: existing
        ? {
            purchaseRequired: existing.purchaseRequired,
            totalCost: existing.totalCost ? existing.totalCost.toString() : null,
          }
        : undefined,
      newValues: {
        purchaseRequired: saved.purchaseRequired,
        totalCost: saved.totalCost ? saved.totalCost.toString() : null,
        vendorId: saved.vendorId,
      },
    });

    // Filed under its author, rather than written over the shared string. The
    // request's comment thread already carries a name and a time on every
    // entry, which is exactly what a note about somebody's spending needs.
    if (input.note) {
      await this.requests.addComment(actor, requestId, input.note, true);
    }

    // A corrected answer has to undo what the wrong one settled. Answering
    // "filled from stock" skips the costing and Finance and approves the
    // request; saying afterwards that it does need buying used to change this
    // record and leave that chain closed, so the correction was cosmetic.
    if (saved.purchaseRequired === true && existing?.purchaseRequired === false) {
      await this.requests.reopenStagesSkippedByStockAnswer(actor, requestId);
    }

    // An inventory-check or cost-assessment stage is completed by doing the
    // work, so recording the answer is what moves the chain on - not a second
    // click on a button asking the same question again.
    await this.requests.completeAssessmentStages(actor, requestId);

    return this.present(saved);
  }

  /**
   * Nobody assesses their own request (v2.26).
   *
   * The permission was the only gate here, and three roles that carry
   * `requests:assess` - IT, Office and Finance - also raise requests of their
   * own. So an IT administrator could state the price on their own laptop
   * request, and that price is what decides whether Finance ever sees it. That
   * is the exact thing moving pricing away from the requester was meant to
   * stop; the rule simply was not enforced on this route the way BR-04 enforces
   * it on the decide route.
   *
   * Reading is refused too, not only writing: the commercial side of your own
   * request is not yours to see, which is what the route's own description has
   * claimed since it was written.
   */
  private assertNotOwnRequest(actor: AuthUser, request: { requesterId: string }) {
    if (request.requesterId === actor.id) {
      throw AppError.forbidden(
        'You cannot assess or price your own request. Ask Office Administration or Finance.',
      );
    }
  }

  /** The request must be one the actor can already see; 404 otherwise. */
  private async assertRequestVisible(actor: AuthUser, requestId: string) {
    const request = await this.prisma.client.assetRequest.findFirst({
      where: { id: requestId, companyId: actor.companyId },
      select: { id: true, status: true, currency: true, requesterId: true },
    });
    if (!request) throw AppError.notFound('Request', requestId);
    return request;
  }

  private present(row: {
    id: string;
    inventoryAvailable: boolean | null;
    purchaseRequired: boolean | null;
    suggestedProduct: string | null;
    unitPrice: Prisma.Decimal | null;
    quantity: number | null;
    taxAmount: Prisma.Decimal | null;
    shipping: Prisma.Decimal | null;
    discount: Prisma.Decimal | null;
    totalCost: Prisma.Decimal | null;
    currency: string | null;
    notes: string | null;
    assessedAt: Date | null;
    vendor: { id: string; name: string } | null;
    suitableAsset: { id: string; assetTag: string; name: string } | null;
    assessedBy: { id: string; profile: { firstName: string; lastName: string } | null } | null;
  }) {
    const money = (v: Prisma.Decimal | null) => (v === null ? null : v.toString());
    return {
      id: row.id,
      inventoryAvailable: row.inventoryAvailable,
      suitableAsset: row.suitableAsset,
      purchaseRequired: row.purchaseRequired,
      suggestedProduct: row.suggestedProduct,
      vendor: row.vendor,
      unitPrice: money(row.unitPrice),
      quantity: row.quantity,
      taxAmount: money(row.taxAmount),
      shipping: money(row.shipping),
      discount: money(row.discount),
      totalCost: money(row.totalCost),
      currency: row.currency,
      notes: row.notes,
      assessedBy: row.assessedBy
        ? {
            id: row.assessedBy.id,
            name: row.assessedBy.profile
              ? `${row.assessedBy.profile.firstName} ${row.assessedBy.profile.lastName}`
              : row.assessedBy.id,
          }
        : null,
      assessedAt: row.assessedAt ? row.assessedAt.toISOString() : null,
    };
  }
}
