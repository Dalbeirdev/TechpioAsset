import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationAdminService } from './notification-admin.service.js';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationAdminService],
  exports: [NotificationsService, NotificationAdminService],
})
export class NotificationsModule {}
