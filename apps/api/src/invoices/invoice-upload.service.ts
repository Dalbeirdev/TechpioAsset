import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import type { AuthUser } from '@techpioasset/contracts';
import { tenantFilter } from '../common/scope.js';
import { AppConfig } from '../config/config.module.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiConfigService } from '../ai-config/ai-config.service.js';
import { AiDocumentProvider } from '../providers/ai/ai-document.provider.js';
import { StorageProvider } from '../providers/storage/storage.provider.js';
import { validateUpload } from '../providers/storage/file-validation.js';
import { InvoicesService } from './invoices.service.js';

/**
 * Handles a document upload and, if AI is enabled for this company, extraction.
 *
 * The order enforces spec section 9's workflow: validate → store → (extract only
 * if the gate permits) → deterministic verification always. The gate is checked
 * before the provider is ever touched, which is what makes "AI disabled → no
 * external call" true by construction rather than by discipline.
 */
@Injectable()
export class InvoiceUploadService {
  private readonly logger = new Logger(InvoiceUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
    private readonly ai: AiDocumentProvider,
    private readonly aiConfig: AiConfigService,
    private readonly invoices: InvoicesService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  async upload(
    actor: AuthUser,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    meta: { vendorId?: string; invoiceNumber?: string },
  ) {
    // 1. Validate the bytes (type + size), by signature not by claim.
    const { sha256, contentType } = validateUpload({
      data: file.buffer,
      declaredMime: file.mimetype,
      allowedMimes: this.config.get('ALLOWED_UPLOAD_MIME'),
      maxBytes: this.config.get('MAX_UPLOAD_MB') * 1024 * 1024,
    });

    // 2. Store privately. The key is opaque; access is signed and permissioned.
    const stored = await this.storage.put({
      prefix: `invoices/${actor.companyId}`,
      originalName: file.originalname,
      contentType,
      data: file.buffer,
    });

    // 3. Create a draft invoice shell to attach the document and any extraction to.
    const invoice = await this.prisma.client.invoice.create({
      data: {
        companyId: actor.companyId,
        // A unique placeholder per upload, not derived from the file: re-uploading
        // the same document must not be blocked at creation. Duplicate detection
        // is a verification *warning* the reviewer sees (via the file hash), not a
        // hard constraint that refuses the upload.
        invoiceNumber: meta.invoiceNumber ?? `UPLOAD-${ulid()}`,
        vendorId: await this.resolveVendor(actor, meta.vendorId),
        invoiceDate: new Date(),
        currency: 'USD',
        verificationStatus: 'UPLOADED',
        createdById: actor.id,
        documents: {
          create: {
            storageKey: stored.key,
            originalName: file.originalname,
            mimeType: contentType,
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            // Malware scanning is a documented hook; with no scanner wired the
            // status is SKIPPED, not silently CLEAN (spec section 1).
            scanStatus: 'SKIPPED',
            uploadedById: actor.id,
          },
        },
      },
      include: { documents: true },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.INVOICE_UPLOADED,
      entityType: 'Invoice',
      entityId: invoice.id,
      newValues: { fileName: file.originalname, sha256, aiEnabled: false },
    });

    // 4. Extraction — only if the gate permits. This is the decisive check.
    const gate = await this.aiConfig.gate(actor.companyId, 'INVOICE_OCR', {
      officeId: actor.officeId,
      roleKeys: actor.roles,
    });

    let extractionSummary: { ran: boolean; simulated: boolean; reason?: string };

    if (!gate.enabled) {
      // No provider is contacted. The invoice waits for manual entry/review.
      this.logger.log(`AI disabled (${gate.reason}); no document submitted for ${invoice.id}`);
      await this.prisma.client.invoice.update({
        where: { id: invoice.id },
        data: { verificationStatus: 'PENDING_REVIEW' },
      });
      extractionSummary = { ran: false, simulated: false, reason: gate.reason };
    } else {
      extractionSummary = await this.runExtraction(
        actor,
        invoice.id,
        file,
        contentType,
        gate.confidenceThreshold,
      );
    }

    // 5. Deterministic verification always runs (section 10).
    await this.invoices.runVerification(actor, invoice.id);

    const result = await this.invoices.findOne(actor, invoice.id);
    return { invoice: result, extraction: extractionSummary };
  }

  private async runExtraction(
    actor: AuthUser,
    invoiceId: string,
    file: { buffer: Buffer; originalname: string },
    contentType: string,
    _confidenceThreshold: number,
  ): Promise<{ ran: boolean; simulated: boolean }> {
    await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { verificationStatus: 'AI_PROCESSING' },
    });

    try {
      const result = await this.ai.extract({
        data: file.buffer,
        contentType,
        fileName: file.originalname,
      });

      // Persist the raw extraction. The original is retained verbatim; any human
      // correction lands on the invoice fields, never overwriting this record
      // (spec section 9: "save the original extraction, corrected values, decision").
      await this.prisma.client.invoiceExtraction.create({
        data: {
          invoiceId,
          provider: result.provider,
          modelName: result.modelName,
          status: 'EXTRACTION_COMPLETED',
          extractedFields: result as unknown as Prisma.InputJsonValue,
          fieldConfidences: this.collectConfidences(result) as unknown as Prisma.InputJsonValue,
          overallConfidence: new Prisma.Decimal(result.overallConfidence),
          startedAt: new Date(Date.now() - result.durationMs),
          completedAt: new Date(),
          durationMs: result.durationMs,
          costUsd: result.costUsd !== null ? new Prisma.Decimal(result.costUsd) : null,
          simulated: result.simulated,
        },
      });

      // Populate the invoice's own fields from the extraction so verification has
      // something to check. A human corrects these before deciding.
      await this.applyExtraction(invoiceId, result);

      await this.aiConfig.recordUsage({
        companyId: actor.companyId,
        userId: actor.id,
        feature: 'INVOICE_OCR',
        provider: result.provider,
        modelName: result.modelName,
        entityType: 'Invoice',
        entityId: invoiceId,
        confidence: result.overallConfidence,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        succeeded: true,
        simulated: result.simulated,
      });

      await this.prisma.client.invoice.update({
        where: { id: invoiceId },
        data: { verificationStatus: 'EXTRACTION_COMPLETED' },
      });

      return { ran: true, simulated: result.simulated };
    } catch (error) {
      this.logger.error(`Extraction failed for ${invoiceId}: ${(error as Error).message}`);
      await this.prisma.client.invoice.update({
        where: { id: invoiceId },
        data: { verificationStatus: 'AI_FAILED' },
      });
      await this.aiConfig.recordUsage({
        companyId: actor.companyId,
        userId: actor.id,
        feature: 'INVOICE_OCR',
        provider: this.ai.name,
        entityType: 'Invoice',
        entityId: invoiceId,
        succeeded: false,
        simulated: false,
        failureDetail: (error as Error).message,
      });
      return { ran: false, simulated: false };
    }
  }

  private async applyExtraction(
    invoiceId: string,
    result: import('../providers/ai/ai-document.provider.js').ExtractionResult,
  ): Promise<void> {
    const num = (v: string | null) =>
      v && /^\d+(\.\d+)?$/.test(v) ? new Prisma.Decimal(v) : undefined;

    await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: {
        // The extracted invoice number is deliberately NOT written to the
        // invoice's own field: it is a unique key, and spec section 9 requires a
        // human to correct extracted fields before they are committed. The
        // suggestion lives in the extraction record; the reviewer applies it.
        ...(result.currency.value ? { currency: result.currency.value } : {}),
        ...(num(result.subtotal.value) ? { subtotal: num(result.subtotal.value) } : {}),
        ...(num(result.tax.value) ? { tax: num(result.tax.value) } : {}),
        ...(num(result.total.value) ? { total: num(result.total.value) } : {}),
        ...(result.invoiceDate.value && !Number.isNaN(Date.parse(result.invoiceDate.value))
          ? { invoiceDate: new Date(result.invoiceDate.value) }
          : {}),
        lines: {
          create: result.lines.map((line) => ({
            lineNumber: line.lineNumber,
            description: line.description.value,
            normalizedDescription: line.description.value,
            quantity: num(line.quantity.value) ?? new Prisma.Decimal(1),
            unitPrice: num(line.unitPrice.value) ?? new Prisma.Decimal(0),
            lineTotal: num(line.lineTotal.value) ?? new Prisma.Decimal(0),
            serialNumbers: line.serialNumbers ?? [],
          })),
        },
      },
    });
  }

  private collectConfidences(
    result: import('../providers/ai/ai-document.provider.js').ExtractionResult,
  ): Record<string, number> {
    return {
      vendorName: result.vendorName.confidence,
      invoiceNumber: result.invoiceNumber.confidence,
      invoiceDate: result.invoiceDate.confidence,
      currency: result.currency.confidence,
      subtotal: result.subtotal.confidence,
      tax: result.tax.confidence,
      total: result.total.confidence,
    };
  }

  private async resolveVendor(actor: AuthUser, vendorId?: string): Promise<string> {
    if (vendorId) {
      const vendor = await this.prisma.client.vendor.findFirst({
        where: { id: vendorId, ...tenantFilter(actor) },
        select: { id: true },
      });
      if (vendor) return vendor.id;
    }
    // Uploads without a stated vendor attach to a placeholder "Unknown vendor",
    // created once per company, which the reviewer reassigns during correction.
    const placeholder = await this.prisma.client.vendor.upsert({
      where: { companyId_code: { companyId: actor.companyId, code: 'UNKNOWN' } },
      update: {},
      create: { companyId: actor.companyId, code: 'UNKNOWN', name: 'Unknown vendor' },
      select: { id: true },
    });
    return placeholder.id;
  }
}
