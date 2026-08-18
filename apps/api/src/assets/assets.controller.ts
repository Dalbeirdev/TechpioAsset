import {
  Body,
  Controller,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { toCsv } from '../common/csv.js';
import {
  assetListQuerySchema,
  assignAssetSchema,
  bulkChangeStatusSchema,
  changeAssetStatusSchema,
  type BulkChangeStatusInput,
  createAssetSchema,
  pageQuerySchema,
  disposeAssetSchema,
  reassignAssetSchema,
  receiveTransferSchema,
  returnAssetSchema,
  transferAssetSchema,
  setAssetPriceSchema,
  updateAssetSchema,
  type AssetListQuery,
  type AssignAssetInput,
  type AuthUser,
  type CreateAssetInput,
  type PageQuery,
  type DisposeAssetInput,
  type ReassignAssetInput,
  type ReceiveTransferInput,
  type ReturnAssetInput,
  type TransferAssetInput,
  type UpdateAssetInput,
  warrantyExtractSchema,
} from '@techpioasset/contracts';
import { PERMISSIONS, type AssetStatus } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { AppError } from '../common/errors/app-error.js';
import { assertSpreadsheet } from '../providers/storage/file-validation.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { AssetsService } from './assets.service.js';
import { AssetImportService } from './asset-import.service.js';
import { LenovoWarrantyService } from './lenovo-warranty.service.js';
import { AssetHealthService } from '../asset-health/asset-health.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '@prisma/client';

@ApiTags('Assets')
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly imports: AssetImportService,
    private readonly health: AssetHealthService,
    private readonly audit: AuditService,
    private readonly lenovoWarranty: LenovoWarrantyService,
  ) {}

  @Post('import')
  @RequirePermissions(PERMISSIONS.ASSETS_IMPORT)
  @ApiOperation({
    summary: 'Bulk-import assets from an Excel sheet',
    description:
      'Upserts assets by serial number and creates any referenced employees as ' +
      'no-login records. Returns a summary of what was created, updated and skipped.',
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async import(
    @CurrentUser() actor: AuthUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 15 * 1024 * 1024 })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer) throw new AppError('FILE_REJECTED', 'No file was received');
    // Verify the bytes are a workbook before the parser sees them - the
    // filename is a claim, not evidence.
    assertSpreadsheet(file.buffer);
    const rows = await this.imports.parseWorkbook(file.buffer);
    return this.imports.importRows(actor, rows);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({
    summary: 'List assets',
    description:
      'Results are restricted to the caller’s data scope. An employee sees only assets assigned ' +
      'to them; cost columns are omitted entirely without assets:cost:read.',
  })
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(assetListQuerySchema)) query: AssetListQuery,
  ) {
    return this.assets.list(actor, query);
  }

  // Declared before ':id' so the static path wins the route match.
  @Get('export')
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({
    summary: 'Export the current asset view as CSV',
    description:
      'Honours the same filters and scope as the list; cost is a column only with access.',
  })
  async export(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(assetListQuerySchema)) query: AssetListQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { columns, rows } = await this.assets.exportRows(actor, query);
    // v2.7 R2 (AUD-009): the asset CSV is an export like any other.
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.REPORT_EXPORTED,
      entityType: 'Report',
      entityId: 'ASSET_CSV',
      newValues: { format: 'CSV', rows: rows.length, delivery: 'DOWNLOAD' },
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="assets-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    });
    return toCsv(columns, rows);
  }

  @Get('by-qr/:token')
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({
    summary: 'Resolve a QR token',
    description: 'Requires authentication and honours scope, so a scanned code leaks nothing.',
  })
  byQr(@CurrentUser() actor: AuthUser, @Param('token') token: string) {
    return this.assets.findByQrToken(actor, token);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({
    summary: 'Read one asset with history, discovered hardware/OS and health',
  })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.assets.findOne(actor, id);
  }

  @Get(':id/software')
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({ summary: 'Discovered software inventory, paginated' })
  listSoftware(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Query(zodBody(pageQuerySchema)) query: PageQuery,
  ) {
    return this.assets.listSoftware(actor, id, query);
  }

  @Post(':id/health/recompute')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({
    summary: 'Recompute the health score now',
    description: 'Returns null when nothing is known about the machine - never a fabricated score.',
  })
  async recomputeHealth(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    // Scope check first: the service recomputes by companyId, the actor must see the asset.
    await this.assets.findOne(actor, id);
    return this.health.recomputeForAsset(actor.companyId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ASSETS_CREATE)
  @ApiOperation({ summary: 'Create an asset' })
  create(@CurrentUser() actor: AuthUser, @Body(zodBody(createAssetSchema)) body: CreateAssetInput) {
    return this.assets.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({ summary: 'Update an asset' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateAssetSchema)) body: UpdateAssetInput,
  ) {
    return this.assets.update(actor, id, body);
  }

  @Post(':id/warranty-refresh')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({
    summary: 'Fetch and record the warranty dates from the manufacturer (Lenovo)',
    description:
      'Looks the serial up at Lenovo and records the returned coverage dates ' +
      'with an audit entry. Available for Lenovo devices; other makers refuse ' +
      'with an explanation.',
  })
  refreshWarranty(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.lenovoWarranty.refreshAsset(actor, id);
  }

  @Post(':id/warranty-extract')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({
    summary: 'Propose a warranty end date from pasted vendor-page text (AI)',
    description:
      'Reads text the caller pasted from the manufacturer warranty page and ' +
      'proposes a coverage end date. Nothing is saved - the caller confirms via ' +
      'the ordinary asset update. Gated on the WARRANTY_EXTRACTION AI feature.',
  })
  extractWarranty(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(warrantyExtractSchema)) body: { text: string },
  ) {
    return this.assets.extractWarranty(actor, id, body.text);
  }

  @Patch(':id/price')
  @RequirePermissions(PERMISSIONS.ASSETS_COST_READ)
  @ApiOperation({
    summary: 'Record an asset price (write-once)',
    description:
      'Finance records a price once; after that it is locked and only a Super Admin ' +
      'may correct it. Every price write is audit-logged.',
  })
  setPrice(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(setAssetPriceSchema)) body: { purchaseCost: string; currency?: string },
  ) {
    return this.assets.setPrice(actor, id, body);
  }

  // Declared before ':id/status' so the static path wins the route match.
  @Post('bulk/status')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({
    summary: 'Change status on many assets at once',
    description:
      'Each asset is validated individually against the state machine; the response ' +
      'lists what succeeded and what did not, so partial failures are explicit.',
  })
  changeStatusBulk(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(bulkChangeStatusSchema)) body: BulkChangeStatusInput,
  ) {
    return this.assets.changeStatusBulk(actor, body.ids, body.status, body.reason);
  }

  @Post(':id/status')
  @ApiOperation({
    summary: 'Change status, validated against the state machine',
    description:
      'Needs assets:update, with one narrow exception enforced in the service: the person ' +
      'currently holding an asset may report it DAMAGED without it. That is why there is no ' +
      'guard here - the rule depends on who holds the asset, which a decorator cannot see.',
  })
  changeStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(changeAssetStatusSchema)) body: { status: AssetStatus; reason?: string },
  ) {
    return this.assets.changeStatus(actor, id, body.status, body.reason);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.ASSETS_ASSIGN)
  @ApiOperation({ summary: 'Assign an asset to an employee' })
  assign(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(assignAssetSchema)) body: AssignAssetInput,
  ) {
    return this.assets.assign(actor, id, body);
  }

  @Post(':id/reassign')
  @RequirePermissions(PERMISSIONS.ASSETS_ASSIGN, PERMISSIONS.ASSETS_RETURN)
  @ApiOperation({
    summary: 'Hand an asset straight from its current holder to another',
    description:
      'One transaction: the outgoing holder gets a real return record and the incoming one a new assignment, with no window where the asset belongs to nobody.',
  })
  reassign(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(reassignAssetSchema)) body: ReassignAssetInput,
  ) {
    return this.assets.reassign(actor, id, body);
  }

  @Post(':id/dispose')
  @RequirePermissions(PERMISSIONS.ASSETS_DISPOSE)
  @ApiOperation({
    summary: "Record an asset's end of life",
    description:
      'Writes a DisposalRecord (method, date, recipient, proceeds, reason) and moves the asset to its terminal status. Recorded, never a delete.',
  })
  dispose(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(disposeAssetSchema)) body: DisposeAssetInput,
  ) {
    return this.assets.dispose(actor, id, body);
  }

  @Post(':id/transfer')
  @RequirePermissions(PERMISSIONS.ASSETS_TRANSFER)
  @ApiOperation({
    summary: 'Send an asset to another office',
    description:
      'The asset goes IN_TRANSIT and stays attributed to the origin office until the destination confirms arrival.',
  })
  transfer(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(transferAssetSchema)) body: TransferAssetInput,
  ) {
    return this.assets.transfer(actor, id, body);
  }

  @Post(':id/transfer/receive')
  @RequirePermissions(PERMISSIONS.ASSETS_TRANSFER)
  @ApiOperation({
    summary: 'Confirm an in-transit asset arrived',
    description: 'Closes the open transfer and moves the asset to the destination office.',
  })
  receiveTransfer(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(receiveTransferSchema)) body: ReceiveTransferInput,
  ) {
    return this.assets.receiveTransfer(actor, id, body);
  }

  @Post(':id/return')
  @RequirePermissions(PERMISSIONS.ASSETS_RETURN)
  @ApiOperation({ summary: 'Receive an asset back from an employee' })
  return(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(returnAssetSchema)) body: ReturnAssetInput,
  ) {
    return this.assets.return(actor, id, body);
  }

  @Post('assignments/:assignmentId/acknowledge')
  @ApiOperation({
    summary: 'Confirm receipt of an assigned asset',
    description:
      'No permission required - but only the assignee may acknowledge, enforced in the service.',
  })
  acknowledge(@CurrentUser() actor: AuthUser, @Param('assignmentId') assignmentId: string) {
    return this.assets.acknowledgeAssignment(actor, assignmentId);
  }
}
