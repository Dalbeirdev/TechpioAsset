import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '@techpioasset/contracts';
import { CurrentUser, SkipRls } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
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
  constructor(private readonly platform: PlatformService) {}

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
