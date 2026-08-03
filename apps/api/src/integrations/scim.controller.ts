import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  scimPatchSchema,
  scimUserSchema,
  type ScimPatchInput,
  type ScimUserInput,
} from '@techpioasset/contracts';
import { Public } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { ScimGuard, type ScimPrincipal } from './scim.guard.js';
import { ScimService } from './scim.service.js';

/**
 * v2.6 A3 — SCIM 2.0 Users, token-authenticated (the hub mints the token).
 * @Public skips the JWT guard; ScimGuard is the real gate.
 */
@ApiTags('scim')
@Public()
@UseGuards(ScimGuard)
@Controller('scim/v2')
export class ScimController {
  constructor(private readonly scim: ScimService) {}

  @Get('Users')
  @ApiOperation({ summary: 'SCIM list/filter users' })
  list(@Req() req: { scim: ScimPrincipal }, @Query('filter') filter?: string) {
    return this.scim.listUsers(req.scim, filter);
  }

  @Get('Users/:id')
  @ApiOperation({ summary: 'SCIM read one user' })
  get(@Req() req: { scim: ScimPrincipal }, @Param('id') id: string) {
    return this.scim.getUser(req.scim, id);
  }

  @Post('Users')
  @ApiOperation({ summary: 'SCIM provision a user (no credentials transported)' })
  create(@Req() req: { scim: ScimPrincipal }, @Body(zodBody(scimUserSchema)) body: ScimUserInput) {
    return this.scim.createUser(req.scim, body);
  }

  @Patch('Users/:id')
  @ApiOperation({ summary: 'SCIM activate/deactivate' })
  patch(
    @Req() req: { scim: ScimPrincipal },
    @Param('id') id: string,
    @Body(zodBody(scimPatchSchema)) body: ScimPatchInput,
  ) {
    return this.scim.patchUser(req.scim, id, body);
  }

  @Delete('Users/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'SCIM deprovision (deactivates; never deletes)' })
  remove(@Req() req: { scim: ScimPrincipal }, @Param('id') id: string): Promise<void> {
    return this.scim.deleteUser(req.scim, id);
  }
}
