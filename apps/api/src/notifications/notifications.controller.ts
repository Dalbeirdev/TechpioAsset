import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  emailLogQuerySchema,
  emailTemplateSchema,
  notificationRuleSchema,
  pageQuerySchema,
  type AuthUser,
  type EmailLogQuery,
  type EmailTemplateInput,
  type NotificationRuleInput,
  type PageQuery,
} from '@techpioasset/contracts';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { PERMISSIONS } from '@techpioasset/domain';
import type { NotificationType } from '@prisma/client';
import { NotificationAdminService } from './notification-admin.service.js';
import { NotificationsService } from './notifications.service.js';

const preferenceSchema = z.object({
  type: z.string().min(1),
  channel: z.enum(['IN_APP', 'EMAIL', 'PUSH', 'TEAMS', 'SLACK']),
  enabled: z.boolean(),
});

const listQuerySchema = pageQuerySchema.extend({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly admin: NotificationAdminService,
  ) {}

  // ── admin plane (v2.18) ─────────────────────────────────────────────────

  @Get('admin/rules')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Routing rules for every notification event' })
  listRules(@CurrentUser() actor: AuthUser) {
    return this.admin.listRules(actor);
  }

  @Patch('admin/rules/:type')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Update one event routing rule' })
  upsertRule(
    @CurrentUser() actor: AuthUser,
    @Param('type') type: string,
    @Body(zodBody(notificationRuleSchema)) body: NotificationRuleInput,
  ) {
    return this.admin.upsertRule(actor, type as NotificationType, body);
  }

  @Get('admin/templates')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Email templates with defaults and overrides' })
  listTemplates(@CurrentUser() actor: AuthUser) {
    return this.admin.listTemplates(actor);
  }

  @Patch('admin/templates/:type')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Save a company email template override' })
  upsertTemplate(
    @CurrentUser() actor: AuthUser,
    @Param('type') type: string,
    @Body(zodBody(emailTemplateSchema)) body: EmailTemplateInput,
  ) {
    return this.admin.upsertTemplate(actor, type as NotificationType, body);
  }

  @Post('admin/templates/:type/reset')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset a template to the built-in default' })
  resetTemplate(@CurrentUser() actor: AuthUser, @Param('type') type: string) {
    return this.admin.resetTemplate(actor, type as NotificationType);
  }

  @Get('admin/templates/:type/preview')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Rendered HTML preview with sample data' })
  previewTemplate(@CurrentUser() actor: AuthUser, @Param('type') type: string) {
    return this.admin.preview(actor, type as NotificationType);
  }

  @Post('admin/templates/:type/test')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @HttpCode(202)
  @ApiOperation({ summary: "Send the sample email to the caller's own inbox" })
  testTemplate(@CurrentUser() actor: AuthUser, @Param('type') type: string) {
    return this.admin.sendTest(actor, type as NotificationType);
  }

  @Get('admin/email-logs')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Outgoing email log with delivery status' })
  emailLogs(@CurrentUser() actor: AuthUser, @Query(zodBody(emailLogQuerySchema)) query: EmailLogQuery) {
    return this.admin.emailLogs(actor, { ...query, type: query.type as NotificationType | undefined });
  }

  @Get('admin/overview')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Dashboard widget: sent today, failed, warranty alerts' })
  overview(@CurrentUser() actor: AuthUser) {
    return this.admin.overview(actor);
  }

  @Get()
  @ApiOperation({
    summary: 'List your notifications',
    description:
      'Always scoped to the caller; there is no way to read another user’s notifications.',
  })
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(listQuerySchema)) query: PageQuery & { unread?: boolean },
  ) {
    return this.notifications.list(actor, query, query.unread ?? false);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread count for the notification bell' })
  async unreadCount(@CurrentUser() actor: AuthUser) {
    return { count: await this.notifications.unreadCount(actor) };
  }

  @Get('preferences')
  @ApiOperation({
    summary: 'Notification preferences',
    description: 'Mandatory types are returned locked and cannot be disabled (spec section 19).',
  })
  preferences(@CurrentUser() actor: AuthUser) {
    return this.notifications.preferences(actor);
  }

  @Patch('preferences')
  @HttpCode(204)
  @ApiOperation({ summary: 'Update one preference' })
  async setPreference(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(preferenceSchema))
    body: { type: string; channel: string; enabled: boolean },
  ): Promise<void> {
    await this.notifications.setPreference(
      actor,
      body.type as Parameters<NotificationsService['setPreference']>[1],
      body.channel as Parameters<NotificationsService['setPreference']>[2],
      body.enabled,
    );
  }

  @Post(':id/read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark one notification read' })
  async markRead(@CurrentUser() actor: AuthUser, @Param('id') id: string): Promise<void> {
    await this.notifications.markRead(actor, id);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark every notification read' })
  markAllRead(@CurrentUser() actor: AuthUser) {
    return this.notifications.markAllRead(actor);
  }
}
