import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { AssetImportService } from './asset-import.service.js';

@Module({
  controllers: [AssetsController],
  providers: [AssetsService, AssetImportService],
  exports: [AssetsService],
})
export class AssetsModule {}
