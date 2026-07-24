import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  setUserRolesSchema,
  setUserStatusSchema,
  userListQuerySchema,
  type AuthUser,
  type SetUserRolesInput,
  type SetUserStatusInput,
  type UserListQuery,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { UsersService } from './users.service.js';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  @ApiOperation({ summary: 'List users visible to the caller, optionally filtered by role' })
  list(@CurrentUser() actor: AuthUser, @Query(zodBody(userListQuerySchema)) query: UserListQuery) {
    return this.users.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  @ApiOperation({
    summary: 'Read one user',
    description: 'Returns 404 rather than 403 for records outside the caller’s scope.',
  })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.findOne(actor, id);
  }

  @Patch(':id/roles')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @ApiOperation({
    summary: 'Replace a user’s roles',
    description: 'The company must always keep at least one active Super Admin.',
  })
  setRoles(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(setUserRolesSchema)) body: SetUserRolesInput,
  ) {
    return this.users.setRoles(actor, id, body);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({
    summary: 'Activate, suspend or deactivate a user',
    description:
      'You cannot change your own status, and the last active Super Admin cannot be disabled.',
  })
  setStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(setUserStatusSchema)) body: SetUserStatusInput,
  ) {
    return this.users.setStatus(actor, id, body);
  }
}
