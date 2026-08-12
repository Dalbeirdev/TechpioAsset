import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createOfficeSchema,
  updateOfficeSchema,
  type AuthUser,
  type CreateOfficeInput,
  type UpdateOfficeInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { OrgService } from './org.service.js';

/** Currency is a label, not a conversion - three letters, upper-cased. */
const updateCompanySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    baseCurrency: z.string().trim().length(3).toUpperCase().optional(),
    timezone: z.string().trim().max(64).optional(),
  })
  .strict();
type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

@ApiTags('Organisation')
@Controller()
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('company')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: "The company's own settings" })
  company(@CurrentUser() actor: AuthUser) {
    return this.org.companySettings(actor);
  }

  @Patch('company')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({
    summary: 'Update company settings',
    description:
      'Base currency labels money going forward (estimates, prices); existing figures are not converted.',
  })
  updateCompany(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(updateCompanySchema)) body: UpdateCompanyInput,
  ) {
    return this.org.updateCompanySettings(actor, body);
  }

  @Get('offices')
  @ApiOperation({ summary: 'Offices with buildings, floors and rooms' })
  offices(@CurrentUser() actor: AuthUser) {
    return this.org.offices(actor);
  }

  @Get('offices/manage')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'All offices, inactive included, for the management page' })
  officesForManagement(@CurrentUser() actor: AuthUser) {
    return this.org.officesForManagement(actor);
  }

  @Post('offices')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Create an office' })
  createOffice(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createOfficeSchema)) body: CreateOfficeInput,
  ) {
    return this.org.createOffice(actor, body);
  }

  @Patch('offices/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Update or deactivate an office' })
  updateOffice(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateOfficeSchema)) body: UpdateOfficeInput,
  ) {
    return this.org.updateOffice(actor, id, body);
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
