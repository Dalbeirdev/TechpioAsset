import { Module } from '@nestjs/common';
import { ProcurementController } from './procurement.controller.js';
import { ProcurementService } from './procurement.service.js';
import { MatchService } from './match.service.js';

@Module({
  controllers: [ProcurementController],
  providers: [ProcurementService, MatchService],
  exports: [MatchService],
})
export class ProcurementModule {}
