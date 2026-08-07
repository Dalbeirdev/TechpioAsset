import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  adminUpdateProfileSchema,
  inviteUserSchema,
  setUserRolesSchema,
  updateMyProfileSchema,
  setUserStatusSchema,
  userListQuerySchema,
  type AdminUpdateProfileInput,
  type InviteUserInput,
  type AuthUser,
  type SetUserRolesInput,
  type SetUserStatusInput,
  type UpdateMyProfileInput,
  type UserListQuery,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { toCsv } from '../common/csv.js';
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

  // Declared before ':id' so the static path wins the route match.
  @Get('export')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  @ApiOperation({ summary: 'Export the current people view as CSV' })
  async export(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(userListQuerySchema)) query: UserListQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { columns, rows } = await this.users.exportRows(actor, query);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="people-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    });
    return toCsv(columns, rows);
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

  @Patch('me/profile')
  @ApiOperation({
    summary: 'Edit your own profile (name, phone, job title)',
    description:
      'Self-service stops where access begins: department and office feed the data scope, ' +
      'so they are set by an administrator, and roles are never edited here.',
  })
  updateMyProfile(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(updateMyProfileSchema)) body: UpdateMyProfileInput,
  ) {
    return this.users.updateProfile(actor, actor.id, body, 'self');
  }

  @Patch(':id/profile')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: "Edit a user's profile, including department and office" })
  updateProfile(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(adminUpdateProfileSchema)) body: AdminUpdateProfileInput,
  ) {
    return this.users.updateProfile(actor, id, body, 'admin');
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

  @Post('invite')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({
    summary: 'Invite a new user',
    description:
      'Creates the account as INVITED and emails a 7-day single-use link. The link is also returned once so it can be handed over directly.',
  })
  invite(@CurrentUser() actor: AuthUser, @Body(zodBody(inviteUserSchema)) body: InviteUserInput) {
    return this.users.invite(actor, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({
    summary: 'Soft-delete a user',
    description:
      'The account disappears from lists and cannot sign in; assignment history and the audit trail are retained. Refused while assets are still assigned.',
  })
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string): Promise<void> {
    await this.users.softDelete(actor, id);
  }
}
