import { createHash, randomBytes } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWebhookSchema,
  updateWebhookSchema,
  WEBHOOK_EVENTS,
  type AuthUser,
  type CreateWebhookInput,
  type UpdateWebhookInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { AppConfig } from '../config/config.module.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { AppError } from '../common/errors/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from './webhooks.service.js';

/**
 * v2.6 A3 — the integrations hub. Everything here needs integrations:manage
 * (Super Admin via ALL). Secrets and tokens are shown exactly once.
 */
@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Hub overview: SSO status, SCIM token, webhook health' })
  async hub(@CurrentUser() actor: AuthUser) {
    const [scimToken, deadCount] = await Promise.all([
      this.prisma.client.scimToken.findUnique({
        where: { companyId: actor.companyId },
        select: { createdAt: true, lastUsedAt: true },
      }),
      this.prisma.client.webhookDelivery.count({
        where: { companyId: actor.companyId, status: 'DEAD' },
      }),
    ]);
    const ssoEnabled = Boolean(
      this.config.get('ENTRA_TENANT_ID') && this.config.get('ENTRA_CLIENT_ID'),
    );
    return {
      sso: { provider: ssoEnabled ? 'entra' : 'disabled', enabled: ssoEnabled },
      scim: {
        enabled: scimToken !== null,
        createdAt: scimToken?.createdAt ?? null,
        lastUsedAt: scimToken?.lastUsedAt ?? null,
      },
      webhooks: { events: WEBHOOK_EVENTS, deadDeliveries: deadCount },
    };
  }

  // ── webhooks ───────────────────────────────────────────────────────────────

  @Get('webhooks')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Webhook subscriptions with per-status delivery counts' })
  listWebhooks(@CurrentUser() actor: AuthUser) {
    return this.webhooks.list(actor);
  }

  @Post('webhooks')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({
    summary: 'Register a webhook',
    description: 'The signing secret is returned ONCE - store it now.',
  })
  createWebhook(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createWebhookSchema)) body: CreateWebhookInput,
  ) {
    return this.webhooks.create(actor, body);
  }

  @Patch('webhooks/:id')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Update url/events or pause a webhook' })
  updateWebhook(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateWebhookSchema)) body: UpdateWebhookInput,
  ) {
    return this.webhooks.update(actor, id, body);
  }

  @Delete('webhooks/:id')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a webhook' })
  removeWebhook(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.webhooks.remove(actor, id);
  }

  @Get('webhooks/:id/deliveries')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Recent deliveries incl. dead-letter detail' })
  deliveries(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.webhooks.deliveries(actor, id);
  }

  // ── SCIM token ─────────────────────────────────────────────────────────────

  @Post('scim/token')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({
    summary: 'Mint (or rotate) the SCIM bearer token',
    description: 'Returned ONCE; only the hash is stored. Rotating invalidates the old token.',
  })
  async mintScimToken(@CurrentUser() actor: AuthUser) {
    const token = `scim_${randomBytes(32).toString('hex')}`;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.prisma.client.scimToken.upsert({
      where: { companyId: actor.companyId },
      create: { companyId: actor.companyId, tokenHash, createdById: actor.id },
      update: { tokenHash, createdById: actor.id, createdAt: new Date(), lastUsedAt: null },
    });
    return { token, endpoint: '/api/v1/scim/v2' };
  }

  @Delete('scim/token')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the SCIM token' })
  async revokeScimToken(@CurrentUser() actor: AuthUser): Promise<void> {
    const result = await this.prisma.client.scimToken.deleteMany({
      where: { companyId: actor.companyId },
    });
    if (result.count === 0) throw AppError.notFound('SCIM token');
  }
}
