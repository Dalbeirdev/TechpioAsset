import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { auditQuerySchema, type AuditQuery, type AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { AuditService } from './audit.service.js';

@ApiTags('Audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({
    summary: 'Read the audit trail',
    description:
      'Append-only, newest first, scoped to the caller’s company. Filter by action, ' +
      'entity, actor, or date range.',
  })
  list(@CurrentUser() actor: AuthUser, @Query(zodBody(auditQuerySchema)) query: AuditQuery) {
    return this.audit.list(actor, query);
  }
}
