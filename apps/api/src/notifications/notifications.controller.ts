import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { pageQuerySchema, type AuthUser, type PageQuery } from '@techpioasset/contracts';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
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
  constructor(private readonly notifications: NotificationsService) {}

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
