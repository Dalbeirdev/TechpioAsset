import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateAiConfigSchema, type AuthUser } from '@techpioasset/contracts';
import { AI_FEATURES, AI_FEATURE_MODES } from '@techpioasset/domain';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { AiConfigService } from './ai-config.service.js';

@ApiTags('AI configuration')
@Controller('ai-config')
export class AiConfigController {
  constructor(private readonly aiConfig: AiConfigService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AI_CONFIGURE)
  @ApiOperation({ summary: 'Read the company AI configuration (Super Admin only)' })
  async get(@CurrentUser() actor: AuthUser) {
    const config = await this.aiConfig.getConfiguration(actor);
    // The catalogue of features and modes travels with the config so the UI need
    // not hard-code enums that live in the domain package.
    return { config, availableFeatures: AI_FEATURES, availableModes: AI_FEATURE_MODES };
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
