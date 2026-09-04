import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { VendorProductImagesService } from './vendor-product-images.service.js';
import { VendorProductsController } from './vendor-products.controller.js';
import { VendorProductsService } from './vendor-products.service.js';

/**
 * The vendor catalogue. Storage and Prisma arrive from their @Global modules;
 * only audit needs importing, as elsewhere.
 */
@Module({
  imports: [AuditModule],
  controllers: [VendorProductsController],
  providers: [VendorProductsService, VendorProductImagesService],
  exports: [VendorProductsService],
})
export class VendorProductsModule {}
