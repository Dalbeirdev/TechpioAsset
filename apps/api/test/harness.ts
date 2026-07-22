import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuthUser } from '@techpioasset/contracts';
import { AppModule } from '../src/app.module.js';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

export const DEMO_PASSWORD = 'TechpioDemo!2026';

export const ACCOUNTS = {
  superAdmin: 'admin@techpioasset.dev',
  itAdmin: 'it@techpioasset.dev',
  hr: 'hr@techpioasset.dev',
  officeAdmin: 'office@techpioasset.dev',
  finance: 'finance@techpioasset.dev',
  manager: 'manager@techpioasset.dev',
  auditor: 'auditor@techpioasset.dev',
  employee: 'employee@techpioasset.dev',
  employee2: 'employee2@techpioasset.dev',
  // Used by the offboarding suite, which assigns and returns assets; keeping it
  // separate stops that churn interfering with the scope assertions elsewhere.
  employee3: 'employee3@techpioasset.dev',
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

export interface Session {
  token: string;
  user: AuthUser;
  refreshCookie: string | undefined;
}

/**
 * Boots the real application - the same module graph, guards and filters that
 * serve production traffic. Mocking the guards here would test the mock, and the
 * guards are precisely what these tests exist to prove.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  await app.init();
  return app;
}

export function api(app: INestApplication) {
  return request(app.getHttpServer());
}

export async function login(
  app: INestApplication,
  email: string,
  password = DEMO_PASSWORD,
): Promise<Session> {
  const response = await api(app).post('/api/v1/auth/login').send({ email, password });
  if (response.status !== 200 || !response.body?.data?.accessToken) {
    throw new Error(
      `Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return {
    token: response.body.data.accessToken,
    user: response.body.data.user,
    refreshCookie: cookies.find((c: string) => c.startsWith('techpioasset_refresh=')),
  };
}

/** Logs in every demo account once, so each spec does not pay the argon2 cost again. */
export async function loginAll(app: INestApplication): Promise<Record<AccountKey, Session>> {
  const entries = await Promise.all(
    (Object.entries(ACCOUNTS) as [AccountKey, string][]).map(
      async ([key, email]) => [key, await login(app, email)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<AccountKey, Session>;
}

export const auth = (session: Session) => ({ Authorization: `Bearer ${session.token}` });
