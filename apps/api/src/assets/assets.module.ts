import { Module } from '@nestjs/common';
import { AiModule } from '../providers/ai/ai.module.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { AssetImportService } from './asset-import.service.js';

@Module({
  imports: [AiModule],
  controllers: [AssetsController],
  providers: [AssetsService, AssetImportService],
  exports: [AssetsService],
})
export class AssetsModule {}
