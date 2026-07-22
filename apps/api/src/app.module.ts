import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { AssetsModule } from './assets/assets.module.js';
import { OrgModule } from './org/org.module.js';
import { UsersModule } from './users/users.module.js';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from './auth/guards/permissions.guard.js';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: Number(config.get('RATE_LIMIT_TTL_SECONDS') ?? 60) * 1000,
            limit: Number(config.get('RATE_LIMIT_MAX') ?? 120),
          },
        ],
      }),
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    UsersModule,
    OrgModule,
    AssetsModule,
  ],
  providers: [
    // Order matters: throttle before authenticating (so an unauthenticated flood
    // is cheap to reject), authenticate before checking permissions.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Express 5 / path-to-regexp 8 syntax: a bare '*' is no longer a valid path.
    consumer.apply(RequestContextMiddleware).forRoutes('{*path}');
  }
}
