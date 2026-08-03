import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller.js';
import { PlatformGuard } from './platform.guard.js';
import { PlatformService } from './platform.service.js';

@Module({
  controllers: [PlatformController],
  providers: [PlatformService, PlatformGuard],
})
export class PlatformModule {}
