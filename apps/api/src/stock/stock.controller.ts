import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  adjustStockSchema,
  batchListQuerySchema,
  convertToAssetSchema,
  countCorrectionSchema,
  createStockLocationSchema,
  issueStockSchema,
  reserveStockSchema,
  stockMovementQuerySchema,
  transferStockSchema,
  updateStockLocationSchema,
  type AdjustStockInput,
  type AuthUser,
  type BatchListQuery,
  type ConvertToAssetInput,
  type CountCorrectionInput,
  type CreateStockLocationInput,
  type IssueStockInput,
  type ReserveStockInput,
  type StockMovementQuery,
  type TransferStockInput,
  type UpdateStockLocationInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { StockService } from './stock.service.js';

/**
 * v2.4 Warehouse stock. Every mutation is an atomic conditional update with a
 * movement row in the same transaction; refusals carry the honest numbers.
 */
@ApiTags('stock')
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('locations')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Stock locations with level counts' })
  listLocations(@CurrentUser() actor: AuthUser) {
    return this.stock.listLocations(actor);
  }

  @Get('batches')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary: 'Lots on the shelf, soonest expiry first',
    description:
      'Each lot reports whether it is fine, going off soon or already expired - computed from ' +
      'the calendar, never stored, because a batch expires without anything happening to the row.',
  })
  listBatches(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(batchListQuerySchema)) query: BatchListQuery,
  ) {
    return this.stock.listBatches(actor, query);
  }

  @Post('locations')
  @RequirePermissions(PERMISSIONS.INVENTORY_LOCATIONS_MANAGE)
  @ApiOperation({ summary: 'Create a stock location' })
  createLocation(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createStockLocationSchema)) body: CreateStockLocationInput,
  ) {
    return this.stock.createLocation(actor, body);
  }

  @Patch('locations/:id')
  @RequirePermissions(PERMISSIONS.INVENTORY_LOCATIONS_MANAGE)
  @ApiOperation({ summary: 'Rename, re-home or de/activate a location' })
  updateLocation(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateStockLocationSchema)) body: UpdateStockLocationInput,
  ) {
    return this.stock.updateLocation(actor, id, body);
  }

  @Get('items')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'The stock-item catalogue' })
  listItems(@CurrentUser() actor: AuthUser) {
    return this.stock.listItems(actor);
  }

  @Get('levels')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Per-location stock levels (filter by item or location)' })
  listLevels(
    @CurrentUser() actor: AuthUser,
    @Query('inventoryItemId') inventoryItemId?: string,
    @Query('stockLocationId') stockLocationId?: string,
  ) {
    return this.stock.listLevels(actor, inventoryItemId, stockLocationId);
  }

  @Get('movements')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'The append-only movement ledger, newest first' })
  listMovements(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(stockMovementQuerySchema)) query: StockMovementQuery,
  ) {
    return this.stock.listMovements(actor, query);
  }

  @Post('issue')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Issue stock out (guarded: never below reservations)' })
  issue(@CurrentUser() actor: AuthUser, @Body(zodBody(issueStockSchema)) body: IssueStockInput) {
    return this.stock.issue(actor, body);
  }

  @Post('adjust')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Manual correction with a mandatory reason' })
  adjust(@CurrentUser() actor: AuthUser, @Body(zodBody(adjustStockSchema)) body: AdjustStockInput) {
    return this.stock.adjust(actor, body);
  }

  @Post('transfer')
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: 'Move stock between locations (one tx, two ledger rows)' })
  transfer(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(transferStockSchema)) body: TransferStockInput,
  ) {
    return this.stock.transfer(actor, body);
  }

  @Post('reserve')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Earmark stock without removing it' })
  reserve(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(reserveStockSchema)) body: ReserveStockInput,
  ) {
    return this.stock.reserve(actor, body);
  }

  @Post('release')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Release a reservation' })
  release(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(reserveStockSchema)) body: ReserveStockInput,
  ) {
    return this.stock.release(actor, body);
  }

  @Post('count-correction')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Post a cycle-count difference to the ledger' })
  countCorrection(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(countCorrectionSchema)) body: CountCorrectionInput,
  ) {
    return this.stock.countCorrection(actor, body);
  }

  @Post('convert-to-asset')
  @RequirePermissions(PERMISSIONS.INVENTORY_CONVERT)
  @ApiOperation({
    summary: 'Turn one stock unit into a tracked asset',
    description: 'Decrement and draft-asset creation happen in a single transaction.',
  })
  convertToAsset(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(convertToAssetSchema)) body: ConvertToAssetInput,
  ) {
    return this.stock.convertToAsset(actor, body);
  }
}
