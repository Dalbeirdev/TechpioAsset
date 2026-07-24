import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  approvalDecisionSchema,
  createRequestSchema,
  requestCommentSchema,
  requestListQuerySchema,
  requestStatusEnum,
  type AuthUser,
  type CreateRequestInput,
  type RequestListQuery,
} from '@techpioasset/contracts';
import { PERMISSIONS, type RequestStatus } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { toCsv } from '../common/csv.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { RequestsService } from './requests.service.js';

const advanceSchema = z.object({ status: requestStatusEnum });
const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

@ApiTags('Requests')
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.REQUESTS_READ)
  @ApiOperation({
    summary: 'List requests',
    description:
      'Scoped to the caller. An employee sees only their own requests and those raised for them; ' +
      'a manager also sees their direct reports’. Pass awaitingMe=true for an approvals inbox.',
  })
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(requestListQuerySchema)) query: RequestListQuery,
  ) {
    return this.requests.list(actor, query);
  }

  // Declared before ':id' so the static path wins the route match.
  @Get('export')
  @RequirePermissions(PERMISSIONS.REQUESTS_READ)
  @ApiOperation({ summary: 'Export the current requests view as CSV' })
  async export(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(requestListQuerySchema)) query: RequestListQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { columns, rows } = await this.requests.exportRows(actor, query);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="requests-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    });
    return toCsv(columns, rows);
  }

  @Get('types')
  @ApiOperation({ summary: 'Request types' })
  types() {
    return this.requests.types();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.REQUESTS_READ)
  @ApiOperation({ summary: 'Read a request with its approval chain and comments' })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.requests.findOne(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.REQUESTS_CREATE)
  @ApiOperation({ summary: 'Create a draft request' })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createRequestSchema)) body: CreateRequestInput,
  ) {
    return this.requests.create(actor, body);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.REQUESTS_CREATE)
  @ApiOperation({
    summary: 'Submit a draft for approval',
    description:
      'Materialises the configured workflow into an approval chain, applying cost thresholds.',
  })
  submit(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.requests.submit(actor, id);
  }

  @Post(':id/decision')
  @RequirePermissions(PERMISSIONS.REQUESTS_APPROVE)
  @ApiOperation({
    summary: 'Approve or reject the current step',
    description:
      'Holding requests:approve is not sufficient — the caller must also be the approver for the ' +
      'step the request is currently waiting on.',
  })
  decide(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(approvalDecisionSchema))
    body: { decision: 'APPROVED' | 'REJECTED'; comment?: string },
  ) {
    return this.requests.decide(actor, id, body.decision, body.comment);
  }

  @Post(':id/advance')
  @RequirePermissions(PERMISSIONS.REQUESTS_APPROVE)
  @ApiOperation({ summary: 'Move an approved request through fulfilment' })
  advance(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(advanceSchema)) body: { status: RequestStatus },
  ) {
    return this.requests.advance(actor, id, body.status);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.REQUESTS_CANCEL)
  @ApiOperation({ summary: 'Cancel a request' })
  cancel(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(cancelSchema)) body: { reason?: string },
  ) {
    return this.requests.cancel(actor, id, body.reason);
  }

  @Post(':id/comments')
  @RequirePermissions(PERMISSIONS.REQUESTS_READ)
  @ApiOperation({ summary: 'Add a comment' })
  comment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(requestCommentSchema)) body: { body: string; isInternal: boolean },
  ) {
    return this.requests.addComment(actor, id, body.body, body.isInternal);
  }
}
