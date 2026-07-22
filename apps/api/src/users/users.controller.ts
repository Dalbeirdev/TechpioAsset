import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { pageQuerySchema, type AuthUser, type PageQuery } from '@techpioasset/contracts';
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
  @ApiOperation({ summary: 'List users visible to the caller' })
  list(@CurrentUser() actor: AuthUser, @Query(zodBody(pageQuerySchema)) query: PageQuery) {
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
}
