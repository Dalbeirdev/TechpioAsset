import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  agentEnrolSchema,
  agentReportSchema,
  confirmMatchSchema,
  discoveryListQuerySchema,
  ingestSchema,
  type AuthUser,
  type ConfirmMatchInput,
  type DiscoveryListQuery,
  type IngestInput,
  type AgentEnrolInput,
  type AgentReportInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { CurrentUser, Public, RequirePermissions } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { DiscoveryService } from './discovery.service.js';
import { AgentGuard, type AgentPrincipal } from './agent.guard.js';
import { AppError } from '../common/errors/app-error.js';
import { Throttle } from '@nestjs/throttler';

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

  // ── agent enrolment & reporting (v2.13) ────────────────────────────────────
  // Two endpoints an installed laptop can reach, and nothing else. Neither
  // requires - or accepts - a human's credential.

  @Post('agents/enrol')
  @Public()
  @HttpCode(200)
  // Guessing an enrolment token is the only way in, so make guessing slow.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Exchange the company enrolment token for a device credential',
    description:
      'Called once per laptop by the agent installer. Re-enrolling the same machine rotates its credential rather than duplicating it.',
  })
  enrolAgent(
    @Headers('x-enrolment-token') enrolmentToken: string | undefined,
    @Body(zodBody(agentEnrolSchema)) body: AgentEnrolInput,
  ) {
    if (!enrolmentToken) {
      throw new AppError('UNAUTHENTICATED', 'Missing enrolment token');
    }
    return this.discovery.enrolAgent(enrolmentToken.trim(), body);
  }

  @Post('agents/report')
  @Public()
  @UseGuards(AgentGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Report this machine inventory',
    description:
      'The device identity comes from the credential, never the body: an agent can only ever describe itself.',
  })
  report(
    @Req() req: { agent?: AgentPrincipal },
    @Body(zodBody(agentReportSchema)) body: AgentReportInput,
  ) {
    return this.discovery.reportFromAgent(req.agent!, body);
  }

  // ── agent administration (humans) ─────────────────────────────────────────

  @Post('agents/enrolment-token')
  @RequirePermissions(PERMISSIONS.DISCOVERY_INGEST)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mint or rotate the enrolment token',
    description: 'Shown once. Rotating invalidates every installer carrying the old one.',
  })
  mintEnrolmentToken(@CurrentUser() actor: AuthUser) {
    return this.discovery.mintEnrolmentToken(actor);
  }

  @Delete('agents/enrolment-token')
  @RequirePermissions(PERMISSIONS.DISCOVERY_INGEST)
  @HttpCode(204)
  @ApiOperation({ summary: 'Disable agent enrolment' })
  async revokeEnrolmentToken(@CurrentUser() actor: AuthUser): Promise<void> {
    await this.discovery.revokeEnrolmentToken(actor);
  }

  @Get('agents')
  @RequirePermissions(PERMISSIONS.DISCOVERY_READ)
  @ApiOperation({ summary: 'Enrolled laptops and when each last reported' })
  listAgents(@CurrentUser() actor: AuthUser) {
    return this.discovery.listAgents(actor);
  }

  @Delete('agents/:id')
  @RequirePermissions(PERMISSIONS.DISCOVERY_RECONCILE)
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke one laptop agent credential' })
  async revokeAgent(@CurrentUser() actor: AuthUser, @Param('id') id: string): Promise<void> {
    await this.discovery.revokeAgent(actor, id);
  }
}
