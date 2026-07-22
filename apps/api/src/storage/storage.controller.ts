import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { CurrentUser } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageProvider } from '../providers/storage/storage.provider.js';
import { LocalStorageProvider } from '../providers/storage/local-storage.provider.js';

/**
 * Serves stored documents.
 *
 * Two independent gates, both required (spec section 20): the caller must be
 * authenticated *and* the request must present a valid, unexpired signature. The
 * signature alone is not enough — an authenticated permission check on the owning
 * invoice runs too — so a leaked URL cannot be replayed by an unauthenticated
 * party, and an authenticated user cannot reach a document they have no right to.
 */
@ApiTags('Storage')
@Controller('storage')
export class StorageController {
  constructor(
    private readonly storage: StorageProvider,
    private readonly prisma: PrismaService,
  ) {}

  @Get('preview/:documentId')
  @ApiOperation({
    summary: 'Stream a document by its id',
    description:
      'Authenticated, permission-checked convenience for the review UI. The invoice must belong ' +
      'to the caller’s company and the caller must hold invoices:read.',
  })
  async preview(
    @CurrentUser() actor: AuthUser,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!actor.permissions.includes('invoices:read')) {
      throw AppError.forbidden('You may not view invoice documents');
    }
    const document = await this.prisma.client.invoiceDocument.findFirst({
      where: { id: documentId, invoice: { companyId: actor.companyId } },
      select: { storageKey: true, mimeType: true, originalName: true },
    });
    if (!document) throw AppError.notFound('Document', documentId);

    const bytes = await this.storage.get(document.storageKey);
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(document.originalName)}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(bytes);
  }

  @Get(':key')
  @ApiOperation({
    summary: 'Download a stored document via a signed URL',
    description: 'Requires authentication and a valid signature; documents are never public.',
  })
  async download(
    @CurrentUser() actor: AuthUser,
    @Param('key') key: string,
    @Query('expires') expires: string,
    @Query('nonce') nonce: string,
    @Query('sig') sig: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    // Signature check (local provider). Cloud providers verify their own signed
    // URLs at the storage layer, but here the API is the storage layer.
    if (this.storage instanceof LocalStorageProvider) {
      const valid = this.storage.verifySignature(key, Number(expires), nonce ?? '', sig ?? '');
      if (!valid) throw new AppError('FORBIDDEN', 'This download link is invalid or has expired');
    }

    // Ownership check: the key must belong to a document in the caller's company.
    // This is what stops one company reading another's invoice by key.
    const document = await this.prisma.client.invoiceDocument.findFirst({
      where: { storageKey: key, invoice: { companyId: actor.companyId } },
      select: { mimeType: true, originalName: true },
    });
    if (!document) throw AppError.notFound('Document');

    const bytes = await this.storage.get(key);
    res.set({
      'Content-Type': document.mimeType,
      // inline so a PDF opens in the reviewer's viewer; the filename is preserved.
      'Content-Disposition': `inline; filename="${encodeURIComponent(document.originalName)}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(bytes);
  }
}
