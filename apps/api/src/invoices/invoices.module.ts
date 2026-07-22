import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoiceUploadService } from './invoice-upload.service.js';

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceUploadService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
