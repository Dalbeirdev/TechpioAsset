import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { OrgService } from './org.service.js';

@ApiTags('Organisation')
@Controller()
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('offices')
  @ApiOperation({ summary: 'Offices with buildings, floors and rooms' })
  offices(@CurrentUser() actor: AuthUser) {
    return this.org.offices(actor);
  }

  @Get('departments')
  @ApiOperation({ summary: 'Departments' })
  departments(@CurrentUser() actor: AuthUser) {
    return this.org.departments(actor);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Asset categories and subcategories' })
  categories(@CurrentUser() actor: AuthUser) {
    return this.org.categories(actor);
  }

  @Get('vendors')
  @RequirePermissions(PERMISSIONS.VENDORS_READ)
  @ApiOperation({ summary: 'Vendors' })
  vendors(@CurrentUser() actor: AuthUser) {
    return this.org.vendors(actor);
  }
}
