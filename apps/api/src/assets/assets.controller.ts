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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assetListQuerySchema,
  assignAssetSchema,
  changeAssetStatusSchema,
  createAssetSchema,
  returnAssetSchema,
  updateAssetSchema,
  type AssetListQuery,
  type AssignAssetInput,
  type AuthUser,
  type CreateAssetInput,
  type ReturnAssetInput,
  type UpdateAssetInput,
} from '@techpioasset/contracts';
import { PERMISSIONS, type AssetStatus } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { AppError } from '../common/errors/app-error.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { AssetsService } from './assets.service.js';
import { AssetImportService } from './asset-import.service.js';

@ApiTags('Assets')
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly imports: AssetImportService,
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
  @ApiOperation({ summary: 'Read one asset with its assignment and condition history' })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.assets.findOne(actor, id);
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

  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({ summary: 'Change status, validated against the state machine' })
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
