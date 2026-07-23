import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { AppConfig } from '../config/config.module.js';

/**
 * Helmet options shared by the production bootstrap and the test harness.
 *
 * Kept in one place so the security integration tests exercise the *same*
 * headers production serves — a config that only lived in `main.ts` would be
 * untested, and drift between the two would be invisible.
 *
 * The API serves JSON and signed redirects only, so the CSP can be as strict as
 * "trust nothing": it costs nothing here and hardens error pages against content
 * sniffing.
 */
export const HELMET_OPTIONS = {
  contentSecurityPolicy: {
    directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  },
  crossOriginResourcePolicy: { policy: 'same-site' as const },
};

/** Applies cookie parsing and security headers. Used by main.ts and the harness. */
export function applySecurityMiddleware(app: INestApplication): void {
  // Refresh tokens travel as httpOnly cookies; this reads them back.
  app.use(cookieParser());
  app.use(helmet(HELMET_OPTIONS));
}

/** Applies the CORS policy. Origins and credentials come from config. */
export function applyCors(app: INestApplication, config: AppConfig): void {
  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    // Refresh tokens travel in an httpOnly cookie, so credentials must be allowed
    // and the origin list must stay explicit - never a wildcard.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id', 'X-Client-Type'],
    exposedHeaders: ['X-Request-Id', 'X-Correlation-Id'],
    maxAge: 600,
  });
}
