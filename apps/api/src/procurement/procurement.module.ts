import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module.js';
import { ProcurementController } from './procurement.controller.js';
import { ProcurementService } from './procurement.service.js';
import { MatchService } from './match.service.js';

@Module({
  // v2.9 C2: approving a charged request commits against its budget.
  imports: [BudgetsModule],
  controllers: [ProcurementController],
  providers: [ProcurementService, MatchService],
  exports: [MatchService],
})
export class ProcurementModule {}
