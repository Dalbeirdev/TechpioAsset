import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateAiConfigSchema, type AuthUser } from '@techpioasset/contracts';
import { AI_FEATURES, AI_FEATURE_MODES } from '@techpioasset/domain';
import { PERMISSIONS } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { AiConfigService } from './ai-config.service.js';
import { RoutingAiProvider } from '../providers/ai/routing-ai.provider.js';

@ApiTags('AI configuration')
@Controller('ai-config')
export class AiConfigController {
  constructor(
    private readonly aiConfig: AiConfigService,
    private readonly ai: RoutingAiProvider,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AI_CONFIGURE)
  @ApiOperation({ summary: 'Read the company AI configuration (Super Admin only)' })
  async get(@CurrentUser() actor: AuthUser) {
    const config = await this.aiConfig.getConfiguration(actor);
    // providerName reports what an extraction would ACTUALLY use - the routed
    // provider - not the stale per-company column, which only ever knew the
    // boot-time value.
    const effective = await this.ai.effective();
    // The catalogue of features and modes travels with the config so the UI need
    // not hard-code enums that live in the domain package.
    return {
      config: { ...config, providerName: effective.provider },
      availableFeatures: AI_FEATURES,
      availableModes: AI_FEATURE_MODES,
    };
  }

  @Get('gate/:feature')
  @ApiOperation({
    summary: 'Whether one AI feature is available to the current user',
    description:
      'Open to any authenticated user - the UI asks this before showing an AI ' +
      'control, so the answer must not need the configure permission.',
  })
  async gateFor(@CurrentUser() actor: AuthUser, @Param('feature') feature: string) {
    if (!AI_FEATURES.includes(feature as (typeof AI_FEATURES)[number])) {
      throw AppError.notFound('AI feature');
    }
    const gate = await this.aiConfig.gate(actor.companyId, feature as (typeof AI_FEATURES)[number], {
      officeId: actor.officeId,
      roleKeys: actor.roles,
    });
    const effective = await this.ai.effective();
    return {
      enabled: gate.enabled,
      reason: gate.reason ?? null,
      requiresHumanReview: gate.requiresHumanReview,
      provider: effective.provider,
      simulated: effective.provider === 'mock',
    };
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.AI_CONFIGURE)
  @ApiOperation({
    summary: 'Update the AI configuration',
    description: 'Enabling AI or changing review requirements is audited in full.',
  })
  update(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(updateAiConfigSchema))
    body: Parameters<AiConfigService['update']>[1],
  ) {
    return this.aiConfig.update(actor, body);
  }
}
