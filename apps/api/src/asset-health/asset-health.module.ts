import { Global, Module } from '@nestjs/common';
import { AssetHealthService } from './asset-health.service.js';

/** Global so discovery, assets and the sweep all share one instance. */
@Global()
@Module({
  providers: [AssetHealthService],
  exports: [AssetHealthService],
})
export class AssetHealthModule {}
