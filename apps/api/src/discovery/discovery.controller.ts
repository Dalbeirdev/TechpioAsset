import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  confirmMatchSchema,
  discoveryListQuerySchema,
  ingestSchema,
  type AuthUser,
  type ConfirmMatchInput,
  type DiscoveryListQuery,
  type IngestInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { DiscoveryService } from './discovery.service.js';

/**
 * v2.5 Discovery. Ingest accepts agent reports; run pulls from the configured
 * provider; the review endpoints resolve the queue. Discovery proposes -
 * only exact serials or humans create asset links.
 */
@ApiTags('discovery')
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Post('ingest')
  @RequirePermissions(PERMISSIONS.DISCOVERY_INGEST)
  @ApiOperation({ summary: 'Ingest a batch of discovered devices (agent push)' })
  ingest(@CurrentUser() actor: AuthUser, @Body(zodBody(ingestSchema)) body: IngestInput) {
    return this.discovery.ingest(actor, body);
  }

  @Post('run')
  @RequirePermissions(PERMISSIONS.DISCOVERY_INGEST)
  @ApiOperation({ summary: 'Pull devices from the configured discovery provider' })
  run(@CurrentUser() actor: AuthUser) {
    return this.discovery.runProvider(actor);
  }

  @Get('devices')
  @RequirePermissions(PERMISSIONS.DISCOVERY_READ)
  @ApiOperation({ summary: 'The discovery review queue (filter by state)' })
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(discoveryListQuerySchema)) query: DiscoveryListQuery,
  ) {
    return this.discovery.list(actor, query);
  }

  @Post('devices/:id/confirm')
  @RequirePermissions(PERMISSIONS.DISCOVERY_RECONCILE)
  @ApiOperation({ summary: 'Confirm a proposed match (optionally overriding the asset)' })
  confirm(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(confirmMatchSchema)) body: ConfirmMatchInput,
  ) {
    return this.discovery.confirm(actor, id, body.assetId);
  }

  @Post('devices/:id/ignore')
  @RequirePermissions(PERMISSIONS.DISCOVERY_RECONCILE)
  @ApiOperation({ summary: 'Ignore a queue item (sticky across re-ingests)' })
  ignore(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.discovery.ignore(actor, id);
  }
}
