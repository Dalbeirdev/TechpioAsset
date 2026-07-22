import { Global, Module } from '@nestjs/common';
import { AiConfigController } from './ai-config.controller.js';
import { AiConfigService } from './ai-config.service.js';

@Global()
@Module({
  controllers: [AiConfigController],
  providers: [AiConfigService],
  exports: [AiConfigService],
})
export class AiConfigModule {}
