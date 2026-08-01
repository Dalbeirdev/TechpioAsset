import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  addLicenseKeySchema,
  assignSeatSchema,
  createLicenseSchema,
  createRenewalSchema,
  licenseListQuerySchema,
  revokeSeatSchema,
  updateLicenseSchema,
  type AddLicenseKeyInput,
  type AssignSeatInput,
  type AuthUser,
  type CreateLicenseInput,
  type CreateRenewalInput,
  type LicenseListQuery,
  type RevokeSeatInput,
  type UpdateLicenseInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { LicensesService } from './licenses.service.js';

/**
 * v2.3 License Management. Seat scarcity is enforced in the service by an
 * atomic conditional increment — assigning the 11th of 10 seats is refused with
 * 409 SEAT_LIMIT_EXCEEDED and honest numbers, and the attempt is audited.
 */
@ApiTags('licenses')
@Controller('licenses')
export class LicensesController {
  constructor(private readonly licenses: LicensesService) {}

  // Declared before ':id' so the static path wins the route match.
  @Get('mine')
  @ApiOperation({ summary: 'The caller’s own active licence seats' })
  mine(@CurrentUser() actor: AuthUser) {
    return this.licenses.mine(actor);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.LICENSES_READ)
  @ApiOperation({ summary: 'List licences with derived seat totals' })
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(licenseListQuerySchema)) query: LicenseListQuery,
  ) {
    return this.licenses.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.LICENSES_READ)
  @ApiOperation({ summary: 'One licence with pools, assignments, renewals and masked keys' })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.licenses.findOne(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.LICENSES_CREATE)
  @ApiOperation({ summary: 'Register a licence (creates its default seat pool)' })
  create(@CurrentUser() actor: AuthUser, @Body(zodBody(createLicenseSchema)) body: CreateLicenseInput) {
    return this.licenses.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.LICENSES_UPDATE)
  @ApiOperation({
    summary: 'Update licence metadata',
    description: 'Seat counts change only through renewals; expiry through renewals.',
  })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateLicenseSchema)) body: UpdateLicenseInput,
  ) {
    return this.licenses.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.LICENSES_DELETE)
  @ApiOperation({ summary: 'Delete a licence that has no active seats' })
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.licenses.remove(actor, id);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.LICENSES_ASSIGN)
  @ApiOperation({
    summary: 'Assign a seat to a user or device',
    description:
      'Transactionally enforced: when every purchased seat is taken the request fails with 409 ' +
      'SEAT_LIMIT_EXCEEDED — there is no override short of buying seats or revoking one.',
  })
  assign(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(assignSeatSchema)) body: AssignSeatInput,
  ) {
    return this.licenses.assign(actor, id, body);
  }

  @Post(':id/revoke')
  @RequirePermissions(PERMISSIONS.LICENSES_REVOKE)
  @ApiOperation({ summary: 'Revoke a seat; it becomes assignable immediately' })
  revoke(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(revokeSeatSchema)) body: RevokeSeatInput,
  ) {
    return this.licenses.revoke(actor, id, body);
  }

  @Post(':id/renewals')
  @RequirePermissions(PERMISSIONS.LICENSES_RENEW)
  @ApiOperation({ summary: 'Renew: extend expiry and/or add seats (append-only history)' })
  renew(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(createRenewalSchema)) body: CreateRenewalInput,
  ) {
    return this.licenses.renew(actor, id, body);
  }

  @Post(':id/keys')
  @RequirePermissions(PERMISSIONS.LICENSES_UPDATE)
  @ApiOperation({ summary: 'Store a licence key (encrypted; served masked)' })
  addKey(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(addLicenseKeySchema)) body: AddLicenseKeyInput,
  ) {
    return this.licenses.addKey(actor, id, body);
  }

  @Post(':id/keys/:keyId/reveal')
  @RequirePermissions(PERMISSIONS.LICENSES_KEYS_REVEAL)
  @ApiOperation({ summary: 'Reveal a key in plaintext — always audited' })
  revealKey(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Param('keyId') keyId: string) {
    return this.licenses.revealKey(actor, id, keyId);
  }
}
