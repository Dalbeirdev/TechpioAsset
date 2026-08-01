import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import { threeWayMatch, type ThreeWayMatchResult } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * v2.4 P3 — the three-way match. The invoice is compared to the value of what
 * was actually RECEIVED against its purchase order (domain logic, 2% / 0.01
 * tolerance). The stored result gates invoice verification: a non-MATCHED
 * outcome blocks approval until a Finance holder overrides it — and every
 * override is audited with its reason.
 */
@Injectable()
export class MatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Recomputes and stores the verdict. Re-running clears any prior override. */
  async run(actor: AuthUser, invoiceId: string): Promise<ThreeWayMatchResult & { overridden: boolean }> {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, companyId: actor.companyId },
      select: {
        id: true,
        total: true,
        purchaseOrderId: true,
        purchaseOrder: {
          select: {
            lines: { select: { quantity: true, receivedQuantity: true, unitPrice: true } },
          },
        },
      },
    });
    if (!invoice) throw AppError.notFound('Invoice', invoiceId);

    const result = threeWayMatch(
      (invoice.purchaseOrder?.lines ?? []).map((l) => ({
        ordered: l.quantity.toString(),
        received: l.receivedQuantity.toString(),
        unitPrice: l.unitPrice.toString(),
      })),
      invoice.total.toString(),
    );

    await this.prisma.client.invoiceMatchResult.upsert({
      where: { invoiceId },
      create: {
        companyId: actor.companyId,
        invoiceId,
        purchaseOrderId: invoice.purchaseOrderId,
        outcome: result.outcome,
        details: result.details,
      },
      update: {
        purchaseOrderId: invoice.purchaseOrderId,
        outcome: result.outcome,
        details: result.details,
        // A fresh verdict invalidates any old override - the numbers changed.
        overriddenById: null,
        overriddenAt: null,
        overrideReason: null,
      },
    });
    return { ...result, overridden: false };
  }

  async get(actor: AuthUser, invoiceId: string) {
    return this.prisma.client.invoiceMatchResult.findFirst({
      where: { invoiceId, companyId: actor.companyId },
    });
  }

  /** Accept a mismatch anyway. Requires a reason; always audited. */
  async override(actor: AuthUser, invoiceId: string, reason: string) {
    const existing = await this.prisma.client.invoiceMatchResult.findFirst({
      where: { invoiceId, companyId: actor.companyId },
      select: { id: true, outcome: true },
    });
    if (!existing) throw AppError.notFound('Match result', invoiceId);
    if (existing.outcome === 'MATCHED') {
      throw AppError.conflict('CONFLICT', 'The match already passed - there is nothing to override');
    }

    await this.prisma.client.invoiceMatchResult.update({
      where: { id: existing.id },
      data: { overriddenById: actor.id, overriddenAt: new Date(), overrideReason: reason },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.MATCH_OVERRIDDEN,
      entityType: 'Invoice',
      entityId: invoiceId,
      previousValues: { outcome: existing.outcome },
      reason,
    });
    return this.get(actor, invoiceId);
  }

  /**
   * The verification gate. Called by InvoicesService before a VERIFIED
   * decision: an invoice tied to a PO must carry a MATCHED (or overridden)
   * verdict — computed fresh here so stale results cannot slip through.
   */
  async assertVerifiable(actor: AuthUser, invoiceId: string): Promise<void> {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, companyId: actor.companyId },
      select: { purchaseOrderId: true },
    });
    if (!invoice?.purchaseOrderId) return; // no PO, no three-way match to satisfy

    const previous = await this.get(actor, invoiceId);
    const wasOverridden = !!previous?.overriddenAt;
    if (wasOverridden) return; // a human accepted the mismatch, on the record

    const fresh = await this.run(actor, invoiceId);
    if (fresh.outcome === 'MATCHED') return;

    const d = fresh.details;
    throw AppError.conflict(
      'CONFLICT',
      `Three-way match failed (${fresh.outcome}): invoice ${d.invoiceTotal.toFixed(2)} vs received ` +
        `${d.receivedValue.toFixed(2)} (delta ${d.delta.toFixed(2)}, tolerance ${d.tolerance.toFixed(2)}). ` +
        'Receive the goods, correct the invoice, or record an audited override.',
    );
  }
}
