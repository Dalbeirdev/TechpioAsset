import { Module } from '@nestjs/common';
import { MobileController } from './mobile.controller.js';
import { MobileSyncService } from './mobile-sync.service.js';

@Module({
  controllers: [MobileController],
  providers: [MobileSyncService],
})
export class MobileModule {}
