import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '@techpioasset/contracts';
import { CurrentUser, SkipRls } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { AppError } from '../common/errors/app-error.js';
import { MfaService } from '../auth/mfa.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RoutingMailProvider } from '../providers/mail/routing-mail.provider.js';
import { PlatformGuard } from './platform.guard.js';
import { PlatformService, type CreateTenantInput } from './platform.service.js';

const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(200),
  adminEmail: z.string().email(),
  adminFirstName: z.string().trim().min(1).max(100),
  adminLastName: z.string().trim().min(1).max(100),
  baseCurrency: z.string().length(3).toUpperCase().optional(),
  timezone: z.string().max(64).optional(),
});

const setActiveSchema = z.object({ isActive: z.boolean() });

/** SMTP settings from the operator console. Password optional on update:
 * absent means "keep the stored one", so editing the host never forces
 * re-typing the credential. */
const mailSettingsSchema = z
  .object({
    host: z.string().trim().min(1).max(255),
    port: z.coerce.number().int().min(1).max(65535).default(587),
    secure: z.boolean().default(false),
    username: z.string().trim().max(255).optional().nullable(),
    password: z.string().max(500).optional(),
    fromAddress: z.string().trim().min(3).max(255),
  })
  .strict();
type MailSettingsInput = z.infer<typeof mailSettingsSchema>;

/** Where to send the test. Gmail/Outlook inboxes judge deliverability; the
 * operator's own address only proves the relay accepts mail at all. */
const testMailSchema = z
  .object({ to: z.string().trim().toLowerCase().email().max(254).optional() })
  .strict();

/**
 * v2.6 A4 — the platform plane. JWT-authenticated AND operator-designated
 * (PlatformGuard checks PLATFORM_ADMIN_EMAILS); no tenant permission opens
 * this door. Every action is audited against the target tenant.
 */
@ApiTags('platform')
@SkipRls()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    private readonly mail: RoutingMailProvider,
  ) {}

  // ── mail settings (v2.12) ─────────────────────────────────────────────────
  // Platform-wide SMTP, editable here so mail setup never needs a server
  // login. The password is stored encrypted and NEVER returned.

  @Get('mail-settings')
  @ApiOperation({ summary: 'Current SMTP settings (password never included)' })
  async mailSettings() {
    const settings = await this.prisma.client.mailSettings.findUnique({
      where: { id: 'default' },
    });
    return settings
      ? {
          configured: true,
          host: settings.host,
          port: settings.port,
          secure: settings.secure,
          username: settings.username,
          fromAddress: settings.fromAddress,
          hasPassword: settings.passwordEncrypted !== null,
          updatedAt: settings.updatedAt,
        }
      : { configured: false };
  }

  @Put('mail-settings')
  @ApiOperation({
    summary: 'Set SMTP settings',
    description:
      'Takes effect on the next send, no restart needed. Omit password to keep the stored one.',
  })
  async setMailSettings(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(mailSettingsSchema)) body: MailSettingsInput,
  ) {
    const existing = await this.prisma.client.mailSettings.findUnique({
      where: { id: 'default' },
      select: { passwordEncrypted: true },
    });
    if (body.password === undefined && !existing) {
      // First-time setup with no password is almost always a mistake (open
      // relays are rare); require an explicit empty string to mean "no auth".
      throw new AppError('VALIDATION_FAILED', 'Provide the SMTP password (or an empty one for servers without authentication)');
    }
    const passwordEncrypted =
      body.password === undefined
        ? (existing?.passwordEncrypted ?? null)
        : body.password === ''
          ? null
          : this.mfa.encryptSecret(body.password);

    await this.prisma.client.mailSettings.upsert({
      where: { id: 'default' },
      update: {
        host: body.host,
        port: body.port,
        secure: body.secure,
        username: body.username ?? null,
        passwordEncrypted,
        fromAddress: body.fromAddress,
        updatedById: actor.id,
      },
      create: {
        id: 'default',
        host: body.host,
        port: body.port,
        secure: body.secure,
        username: body.username ?? null,
        passwordEncrypted,
        fromAddress: body.fromAddress,
        updatedById: actor.id,
      },
    });
    return this.mailSettings();
  }

  @Delete('mail-settings')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove SMTP settings (falls back to env config or simulated mail)' })
  async clearMailSettings(): Promise<void> {
    await this.prisma.client.mailSettings.deleteMany({ where: { id: 'default' } });
  }

  @Post('mail-settings/test')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a test email through the current settings',
    description:
      'delivered=false means mail is still simulated - nothing left this machine. Defaults to the caller; pass "to" to test delivery to an external inbox.',
  })
  async testMailSettings(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(testMailSchema)) body: { to?: string },
  ) {
    const to = body.to ?? actor.email;
    try {
      const result = await this.mail.send({
        to,
        subject: 'TechpioAsset SMTP test',
        text: 'SMTP is configured correctly - invitation and notification emails will be delivered.',
      });
      return { delivered: !result.simulated, to };
    } catch (error) {
      // A wrong host/credential should read as a clear answer, not a 500.
      return { delivered: false, to, error: (error as Error).message };
    }
  }

  @Get('tenants')
  @ApiOperation({ summary: 'Every tenant with usage counts (operator view)' })
  list() {
    return this.platform.listTenants();
  }

  @Post('tenants')
  @ApiOperation({
    summary: 'Provision an isolated tenant with a bootstrap Super Admin',
    description: 'The initial password is returned ONCE.',
  })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createTenantSchema)) body: CreateTenantInput,
  ) {
    return this.platform.createTenant(actor, body);
  }

  @Patch('tenants/:id/active')
  @ApiOperation({ summary: 'Suspend or reactivate a tenant (suspension blocks all logins)' })
  setActive(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(setActiveSchema)) body: { isActive: boolean },
  ) {
    return this.platform.setActive(actor, id, body.isActive);
  }
}
