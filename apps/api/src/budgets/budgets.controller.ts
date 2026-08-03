import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  budgetListQuerySchema,
  costCentreListQuerySchema,
  createBudgetSchema,
  createCostCentreSchema,
  updateBudgetSchema,
  updateCostCentreSchema,
  type AuthUser,
  type BudgetListQuery,
  type CostCentreListQuery,
  type CreateBudgetInput,
  type CreateCostCentreInput,
  type UpdateBudgetInput,
  type UpdateCostCentreInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { BudgetsService } from './budgets.service.js';

/**
 * v2.9 C2. Two permissions are in play and they are not the same question:
 * FINANCE_BUDGETS_MANAGE sets the limit, ASSETS_COST_READ sees the money.
 * Cost-centre *names* are not money, so anyone who can raise a purchase
 * request may list them - otherwise nobody could say what they are charging.
 */
@ApiTags('budgets')
@Controller()
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get('cost-centres')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_READ)
  @ApiOperation({ summary: 'Cost centres a purchase can be charged to' })
  listCostCentres(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(costCentreListQuerySchema)) query: CostCentreListQuery,
  ) {
    return this.budgets.listCostCentres(actor, query);
  }

  @Post('cost-centres')
  @RequirePermissions(PERMISSIONS.FINANCE_BUDGETS_MANAGE)
  @ApiOperation({ summary: 'Create a cost centre' })
  createCostCentre(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createCostCentreSchema)) body: CreateCostCentreInput,
  ) {
    return this.budgets.createCostCentre(actor, body);
  }

  @Patch('cost-centres/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_BUDGETS_MANAGE)
  @ApiOperation({ summary: 'Rename, re-home or deactivate a cost centre' })
  updateCostCentre(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateCostCentreSchema)) body: UpdateCostCentreInput,
  ) {
    return this.budgets.updateCostCentre(actor, id, body);
  }

  @Get('budgets')
  @RequirePermissions(PERMISSIONS.ASSETS_COST_READ)
  @ApiOperation({
    summary: 'Budgets with what each has committed and what remains',
    description: 'A budget is a money figure, so reading one follows the standing Finance + Super Admin rule.',
  })
  listBudgets(@CurrentUser() actor: AuthUser, @Query(zodBody(budgetListQuerySchema)) query: BudgetListQuery) {
    return this.budgets.listBudgets(actor, query);
  }

  @Get('budgets/report')
  @RequirePermissions(PERMISSIONS.ASSETS_COST_READ)
  @ApiOperation({ summary: 'Cost-centre consumption on a given day (defaults to today)' })
  report(@CurrentUser() actor: AuthUser, @Query('on') on?: string) {
    return this.budgets.consumptionReport(actor, on ? new Date(on) : undefined);
  }

  @Get('budgets/:id')
  @RequirePermissions(PERMISSIONS.ASSETS_COST_READ)
  @ApiOperation({ summary: 'One budget, with the requests its commitment is holding' })
  findBudget(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.budgets.findBudget(actor, id);
  }

  @Post('budgets')
  @RequirePermissions(PERMISSIONS.FINANCE_BUDGETS_MANAGE)
  @ApiOperation({ summary: 'Set a budget for a cost centre and period' })
  createBudget(@CurrentUser() actor: AuthUser, @Body(zodBody(createBudgetSchema)) body: CreateBudgetInput) {
    return this.budgets.createBudget(actor, body);
  }

  @Patch('budgets/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_BUDGETS_MANAGE)
  @ApiOperation({
    summary: 'Adjust a budget amount, name or notes',
    description: 'The period and cost centre are fixed: moving them would re-point live commitments.',
  })
  updateBudget(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateBudgetSchema)) body: UpdateBudgetInput,
  ) {
    return this.budgets.updateBudget(actor, id, body);
  }
}
