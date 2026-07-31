import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createRoleSchema,
  updateRoleSchema,
  type AuthUser,
  type CreateRoleInput,
  type UpdateRoleInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { RolesService } from './roles.service.js';

/**
 * v2.2 Workstream G — runtime role administration. Every route requires
 * `roles:manage`; the service upholds the system-role and read-only invariants.
 */
@ApiTags('roles')
@Controller('roles')
@RequirePermissions(PERMISSIONS.ROLES_MANAGE)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'List roles in the tenant with grant and member counts' })
  list(@CurrentUser() actor: AuthUser) {
    return this.roles.list(actor);
  }

  // Declared before ':id' so the static path wins the route match.
  @Get('permissions')
  @ApiOperation({ summary: 'The permission catalogue, grouped by resource' })
  permissions() {
    return this.roles.listPermissions();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one role and the permissions it grants' })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.roles.findOne(actor, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom role' })
  create(@CurrentUser() actor: AuthUser, @Body(zodBody(createRoleSchema)) body: CreateRoleInput) {
    return this.roles.create(actor, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a custom role or change its permissions' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateRoleSchema)) body: UpdateRoleInput,
  ) {
    return this.roles.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a custom role that has no members' })
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.roles.remove(actor, id);
  }
}
