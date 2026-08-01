import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  convertPurchaseRequestSchema,
  createPurchaseRequestSchema,
  decidePurchaseRequestSchema,
  prListQuerySchema,
  receiveGrnSchema,
  type AuthUser,
  type ConvertPurchaseRequestInput,
  type CreatePurchaseRequestInput,
  type DecidePurchaseRequestInput,
  type PrListQuery,
  type ReceiveGrnInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { ProcurementService } from './procurement.service.js';
import { MatchService } from './match.service.js';

/**
 * v2.4 Procurement. SoD is enforced in the service (a requester never decides
 * their own PR); above the Finance threshold the approver must also hold the
 * cost permission. Over-receipt is transactionally impossible.
 */
@ApiTags('procurement')
@Controller('procurement')
export class ProcurementController {
  constructor(
    private readonly procurement: ProcurementService,
    private readonly match: MatchService,
  ) {}

  // ── purchase requests ──────────────────────────────────────────────────────

  @Get('requests')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_READ)
  @ApiOperation({ summary: 'List purchase requests (pass mine=true for your own)' })
  listPrs(@CurrentUser() actor: AuthUser, @Query(zodBody(prListQuerySchema)) query: PrListQuery) {
    return this.procurement.listPrs(actor, query);
  }

  @Get('requests/:id')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_READ)
  @ApiOperation({ summary: 'One purchase request with its lines' })
  findPr(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.procurement.findPr(actor, id);
  }

  @Post('requests')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_CREATE)
  @ApiOperation({ summary: 'Draft a purchase request' })
  createPr(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createPurchaseRequestSchema)) body: CreatePurchaseRequestInput,
  ) {
    return this.procurement.createPr(actor, body);
  }

  @Post('requests/:id/submit')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_CREATE)
  @ApiOperation({ summary: 'Submit a draft for approval (requester only)' })
  submitPr(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.procurement.submitPr(actor, id);
  }

  @Post('requests/:id/decision')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_APPROVE)
  @ApiOperation({
    summary: 'Approve or reject a submitted purchase request',
    description:
      'SoD: the requester cannot decide their own PR. At or above the Finance threshold the ' +
      'approver must also hold the cost permission.',
  })
  decidePr(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(decidePurchaseRequestSchema)) body: DecidePurchaseRequestInput,
  ) {
    return this.procurement.decidePr(actor, id, body);
  }

  @Post('requests/:id/convert')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_CONVERT)
  @ApiOperation({ summary: 'Convert an approved PR into a draft purchase order' })
  convertPr(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(convertPurchaseRequestSchema)) body: ConvertPurchaseRequestInput,
  ) {
    return this.procurement.convertPr(actor, id, body);
  }

  // ── three-way match ────────────────────────────────────────────────────────

  @Get('match/:invoiceId')
  @RequirePermissions(PERMISSIONS.INVOICES_READ)
  @ApiOperation({ summary: 'The stored three-way-match verdict for an invoice' })
  getMatch(@CurrentUser() actor: AuthUser, @Param('invoiceId') invoiceId: string) {
    return this.match.get(actor, invoiceId);
  }

  @Post('match/:invoiceId/run')
  @RequirePermissions(PERMISSIONS.INVOICES_VERIFY)
  @ApiOperation({ summary: 'Recompute the match (clears any prior override)' })
  runMatch(@CurrentUser() actor: AuthUser, @Param('invoiceId') invoiceId: string) {
    return this.match.run(actor, invoiceId);
  }

  @Post('match/:invoiceId/override')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_MATCH_OVERRIDE)
  @ApiOperation({
    summary: 'Accept a mismatched invoice anyway',
    description: 'Requires a reason; the override is written to the audit log.',
  })
  overrideMatch(
    @CurrentUser() actor: AuthUser,
    @Param('invoiceId') invoiceId: string,
    @Body() body: { reason?: string },
  ) {
    const reason = body?.reason?.trim();
    if (!reason || reason.length < 10) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Give a reason of at least 10 characters - it goes on the audit record',
      );
    }
    return this.match.override(actor, invoiceId, reason);
  }

  // ── purchase orders ────────────────────────────────────────────────────────

  @Get('orders')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_READ)
  @ApiOperation({ summary: 'List purchase orders' })
  listPos(@CurrentUser() actor: AuthUser, @Query(zodBody(prListQuerySchema)) query: PrListQuery) {
    return this.procurement.listPos(actor, query);
  }

  @Get('orders/:id')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_READ)
  @ApiOperation({ summary: 'One purchase order with lines and receipts' })
  findPo(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.procurement.findPo(actor, id);
  }

  @Post('orders/:id/issue')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PO_ISSUE)
  @ApiOperation({ summary: 'Issue a draft PO to its vendor' })
  issuePo(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.procurement.issuePo(actor, id);
  }

  @Post('orders/:id/cancel')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PO_ISSUE)
  @ApiOperation({ summary: 'Cancel a PO that has received no goods' })
  cancelPo(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.procurement.cancelPo(actor, id, body?.reason ?? null);
  }

  @Post('orders/:id/receive')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_RECEIVE)
  @ApiOperation({
    summary: 'Receive goods against an issued PO',
    description:
      'Partial deliveries accumulate; receiving more than the outstanding remainder on any line ' +
      'is refused with the honest numbers. STOCK intake posts to the ledger and stock levels.',
  })
  receive(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(receiveGrnSchema)) body: ReceiveGrnInput,
  ) {
    return this.procurement.receive(actor, id, body);
  }
}
