import { Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { IntegrationsController } from './integrations.controller.js';
import { ScimController } from './scim.controller.js';
import { ScimGuard } from './scim.guard.js';
import { ScimService } from './scim.service.js';
import { WebhooksService } from './webhooks.service.js';

/** Global so business modules can publish webhook events without imports. */
@Global()
@Module({
  imports: [UsersModule],
  controllers: [IntegrationsController, ScimController],
  providers: [WebhooksService, ScimService, ScimGuard],
  exports: [WebhooksService],
})
export class IntegrationsModule {}
