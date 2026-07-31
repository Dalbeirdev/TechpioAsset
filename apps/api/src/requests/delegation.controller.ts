import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createDelegationSchema, type AuthUser, type CreateDelegationInput } from '@techpioasset/contracts';
import { CurrentUser } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { DelegationService } from './delegation.service.js';

/**
 * v2.2 Workstream D — a user manages their own approval delegations. No special
 * permission: anyone may delegate the approvals they themselves hold. Authority
 * is still checked at decide time, so delegating never grants new power.
 */
@ApiTags('approvals')
@Controller('delegations')
export class DelegationController {
  constructor(private readonly delegations: DelegationService) {}

  @Get()
  @ApiOperation({ summary: 'Delegations I have given and received' })
  list(@CurrentUser() actor: AuthUser) {
    return this.delegations.listForUser(actor);
  }

  @Post()
  @ApiOperation({ summary: 'Delegate my approval authority to another user' })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createDelegationSchema)) body: CreateDelegationInput,
  ) {
    return this.delegations.create(actor, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke a delegation I created' })
  revoke(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.delegations.revoke(actor, id);
  }
}
