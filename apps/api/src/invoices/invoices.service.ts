import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma, type VerificationStatus } from '@prisma/client';
import type { AuthUser, CreateInvoiceInput, InvoiceListQuery } from '@techpioasset/contracts';
import {
  assertHumanDecisionOnly,
  verifyInvoice,
  type InvoiceInput,
  type VerificationContext,
  type VerificationIssue,
  PERMISSIONS,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { buildOrderBy, paginate } from '../common/paginate.js';
import { tenantFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SORTABLE = [
  'createdAt',
  'invoiceDate',
  'invoiceNumber',
  'total',
  'verificationStatus',
] as const;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  async list(actor: AuthUser, query: InvoiceListQuery) {
    const where: Prisma.InvoiceWhereInput = {
      AND: [
        tenantFilter(actor),
        {
          ...(query.verificationStatus
            ? { verificationStatus: query.verificationStatus as VerificationStatus }
            : {}),
          ...(query.vendorId ? { vendorId: query.vendorId } : {}),
          ...(query.paymentStatus
            ? { paymentStatus: query.paymentStatus as Prisma.InvoiceWhereInput['paymentStatus'] }
            : {}),
          ...(query.q
            ? {
                OR: [
                  { invoiceNumber: { contains: query.q, mode: 'insensitive' } },
                  { vendor: { name: { contains: query.q, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
      ],
    };

    return paginate(query, {
      count: () => this.prisma.client.invoice.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.invoice.findMany({
          where,
          skip,
          take,
          orderBy: buildOrderBy(query.sort, query.order, SORTABLE, 'createdAt'),
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            currency: true,
            total: true,
            paymentStatus: true,
            verificationStatus: true,
            createdAt: true,
            vendor: { select: { id: true, name: true } },
            _count: { select: { documents: true, lines: true } },
          },
        }),
    });
  }

  async findOne(actor: AuthUser, id: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id, ...tenantFilter(actor) },
      include: {
        vendor: { select: { id: true, name: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: {
            assetLinks: {
              include: {
                asset: { select: { id: true, assetTag: true, name: true } },
                inventoryItem: { select: { id: true, sku: true, name: true } },
              },
            },
          },
        },
        documents: {
          where: { deletedAt: null },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            pageCount: true,
            scanStatus: true,
            uploadedAt: true,
          },
        },
        extractions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            provider: true,
            modelName: true,
            status: true,
            extractedFields: true,
            fieldConfidences: true,
            overallConfidence: true,
            simulated: true,
            durationMs: true,
            createdAt: true,
          },
        },
        verifications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            checkResults: true,
            issues: true,
            outcome: true,
            decidedAt: true,
            notes: true,
            decidedBy: {
              select: {
                id: true,
                email: true,
                profile: { select: { firstName: true, lastName: true } },
              },
            },
            createdAt: true,
          },
        },
      },
    });

    if (!invoice) throw AppError.notFound('Invoice', id);
    return invoice;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Manual creation (AI-disabled path must stay fully functional — section 10)
  // ───────────────────────────────────────────────────────────────────────────

  async create(actor: AuthUser, input: CreateInvoiceInput) {
    const vendor = await this.prisma.client.vendor.findFirst({
      where: { id: input.vendorId, ...tenantFilter(actor) },
      select: { id: true },
    });
    if (!vendor) throw AppError.notFound('Vendor', input.vendorId);

    const invoice = await this.prisma.client.invoice.create({
      data: {
        companyId: actor.companyId,
        invoiceNumber: input.invoiceNumber,
        vendorId: input.vendorId,
        invoiceDate: input.invoiceDate,
        purchaseDate: input.purchaseDate ?? null,
        dueDate: input.dueDate ?? null,
        currency: input.currency,
        subtotal: new Prisma.Decimal(input.subtotal),
        discount: new Prisma.Decimal(input.discount),
        tax: new Prisma.Decimal(input.tax),
        shipping: new Prisma.Decimal(input.shipping),
        otherCharges: new Prisma.Decimal(input.otherCharges),
        total: new Prisma.Decimal(input.total),
        paymentStatus: input.paymentStatus,
        poNumber: input.purchaseOrderNumber ?? null,
        notes: input.notes ?? null,
        // Deterministic PO reconciliation uses this figure when present.
        // Straight to review: no AI was involved, so there is nothing to extract.
        verificationStatus: 'PENDING_REVIEW',
        createdById: actor.id,
        lines: {
          create: input.lines.map((line) => ({
            lineNumber: line.lineNumber,
            description: line.description,
            quantity: new Prisma.Decimal(line.quantity),
            unitPrice: new Prisma.Decimal(line.unitPrice),
            lineTotal: new Prisma.Decimal(line.lineTotal),
            serialNumbers: line.serialNumbers ?? [],
            warrantyMonths: line.warrantyMonths ?? null,
          })),
        },
      },
      select: { id: true, invoiceNumber: true },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.INVOICE_UPLOADED,
      entityType: 'Invoice',
      entityId: invoice.id,
      newValues: { invoiceNumber: input.invoiceNumber, manual: true },
    });

    // Run deterministic verification immediately; it needs no AI.
    await this.runVerification(actor, invoice.id);
    return this.findOne(actor, invoice.id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Deterministic verification (spec section 9 — never AI)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Gathers application facts, runs the pure engine, and records the report.
   *
   * This runs regardless of whether AI is enabled — spec section 10: "Backend
   * validation rules must continue to work" when AI is disabled. The engine
   * itself is in packages/domain and touches no I/O.
   */
  async runVerification(actor: AuthUser, invoiceId: string) {
    const invoice = await this.prisma.client.invoice.findFirstOrThrow({
      where: { id: invoiceId, ...tenantFilter(actor) },
      include: {
        lines: { include: { assetLinks: true }, orderBy: { lineNumber: 'asc' } },
        documents: { where: { deletedAt: null }, select: { sha256: true, id: true } },
      },
    });

    const company = await this.prisma.client.company.findUniqueOrThrow({
      where: { id: actor.companyId },
      select: { baseCurrency: true },
    });

    // Duplicate invoice number (any *other* invoice with this number).
    const duplicateNumbers = await this.prisma.client.invoice.findMany({
      where: {
        companyId: actor.companyId,
        invoiceNumber: invoice.invoiceNumber,
        id: { not: invoice.id },
      },
      select: { id: true },
    });

    // Duplicate file hash across the company's documents.
    const hashes = invoice.documents.map((d) => d.sha256);
    const duplicateHashes = hashes.length
      ? await this.prisma.client.invoiceDocument.findMany({
          where: {
            sha256: { in: hashes },
            invoice: { companyId: actor.companyId },
            invoiceId: { not: invoice.id },
          },
          select: { id: true },
        })
      : [];

    // Serial numbers already on an asset.
    const invoiceSerials = invoice.lines.flatMap((l) => l.serialNumbers);
    const knownSerials = invoiceSerials.length
      ? (
          await this.prisma.client.asset.findMany({
            where: { companyId: actor.companyId, serialNumber: { in: invoiceSerials } },
            select: { serialNumber: true },
          })
        )
          .map((a) => a.serialNumber)
          .filter((s): s is string => s !== null)
      : [];

    const lineMatches: VerificationContext['lineMatches'] = {};
    for (const line of invoice.lines) {
      lineMatches[line.lineNumber] = { matched: line.assetLinks.length > 0 };
    }

    const engineInput: InvoiceInput = {
      invoiceNumber: invoice.invoiceNumber,
      currency: invoice.currency,
      invoiceDate: invoice.invoiceDate,
      subtotal: invoice.subtotal.toString(),
      discount: invoice.discount.toString(),
      tax: invoice.tax.toString(),
      shipping: invoice.shipping.toString(),
      otherCharges: invoice.otherCharges.toString(),
      total: invoice.total.toString(),
      fileSha256: hashes[0],
      lines: invoice.lines.map((line) => ({
        lineNumber: line.lineNumber,
        description: line.description,
        quantity: line.quantity.toString(),
        unitPrice: line.unitPrice.toString(),
        lineTotal: line.lineTotal.toString(),
        serialNumbers: line.serialNumbers,
      })),
    };

    const context: VerificationContext = {
      duplicateInvoiceNumbers: duplicateNumbers.map((d) => d.id),
      duplicateFileHashes: duplicateHashes.map((d) => d.id),
      knownSerialNumbers: knownSerials,
      lineMatches,
      allowedCurrencies: [company.baseCurrency, 'USD', 'EUR', 'GBP', 'INR'],
    };

    const report = verifyInvoice(engineInput, context);

    await this.prisma.client.$transaction([
      this.prisma.client.invoiceVerification.create({
        data: {
          invoiceId: invoice.id,
          checkResults: report.computed as unknown as Prisma.InputJsonValue,
          issues: report.issues as unknown as Prisma.InputJsonValue,
          outcome: report.outcome,
        },
      }),
      this.prisma.client.invoice.update({
        where: { id: invoice.id },
        data: { verificationStatus: report.outcome },
      }),
    ]);

    return report;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Human decision (spec section 9 — AI may never do this)
  // ───────────────────────────────────────────────────────────────────────────

  async decide(actor: AuthUser, id: string, decision: 'VERIFIED' | 'REJECTED', notes?: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id, ...tenantFilter(actor) },
      select: { id: true, verificationStatus: true, invoiceNumber: true },
    });
    if (!invoice) throw AppError.notFound('Invoice', id);

    // The domain guard: VERIFIED/REJECTED require an authenticated human. Passing
    // the actor proves a person made this call; an automated path has no userId
    // and would throw AutomatedApprovalError.
    assertHumanDecisionOnly(decision, { userId: actor.id, automated: false });

    const latestVerification = await this.prisma.client.invoiceVerification.findFirst({
      where: { invoiceId: id },
      orderBy: { createdAt: 'desc' },
    });

    await this.prisma.client.$transaction([
      this.prisma.client.invoice.update({
        where: { id },
        data: {
          verificationStatus: decision,
          reviewerId: actor.id,
          reviewedAt: new Date(),
          reviewNotes: notes ?? null,
        },
      }),
      ...(latestVerification
        ? [
            this.prisma.client.invoiceVerification.update({
              where: { id: latestVerification.id },
              data: { outcome: decision, decidedById: actor.id, decidedAt: new Date(), notes },
            }),
          ]
        : []),
    ]);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action:
        decision === 'VERIFIED'
          ? AuditAction.VERIFICATION_APPROVED
          : AuditAction.VERIFICATION_REJECTED,
      entityType: 'Invoice',
      entityId: id,
      previousValues: { verificationStatus: invoice.verificationStatus },
      newValues: { verificationStatus: decision },
      reason: notes,
    });

    return this.findOne(actor, id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Asset linking (spec section 8)
  // ───────────────────────────────────────────────────────────────────────────

  async linkLine(
    actor: AuthUser,
    invoiceId: string,
    lineId: string,
    target: { assetId?: string; inventoryItemId?: string },
  ) {
    if (!target.assetId && !target.inventoryItemId) {
      throw new AppError('VALIDATION_FAILED', 'Provide an asset or inventory item to link');
    }

    const line = await this.prisma.client.invoiceLine.findFirst({
      where: { id: lineId, invoice: { id: invoiceId, ...tenantFilter(actor) } },
      select: { id: true, quantity: true, unitPrice: true },
    });
    if (!line) throw AppError.notFound('Invoice line', lineId);

    if (target.assetId) {
      const asset = await this.prisma.client.asset.findFirst({
        where: { id: target.assetId, ...tenantFilter(actor) },
        select: { id: true },
      });
      if (!asset) throw AppError.notFound('Asset', target.assetId);
    }

    await this.prisma.client.assetInvoiceLink.upsert({
      where: { invoiceLineId_assetId: { invoiceLineId: lineId, assetId: target.assetId ?? '' } },
      update: { inventoryItemId: target.inventoryItemId ?? null },
      create: {
        invoiceLineId: lineId,
        assetId: target.assetId ?? null,
        inventoryItemId: target.inventoryItemId ?? null,
        matchMethod: 'MANUAL',
        createdById: actor.id,
      },
    });

    // A new link can change the verification outcome (an unlinked line becomes
    // matched), so re-run it.
    await this.runVerification(actor, invoiceId);
    return this.findOne(actor, invoiceId);
  }

  /** Exposes the latest issues, for the review screen's issue panel. */
  latestIssues(verification: { issues: unknown } | null): VerificationIssue[] {
    return (verification?.issues as VerificationIssue[] | undefined) ?? [];
  }

  canVerify(actor: AuthUser): boolean {
    return actor.permissions.includes(PERMISSIONS.INVOICES_VERIFY);
  }
}
