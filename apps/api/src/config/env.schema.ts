import { z } from 'zod';

/**
 * Environment validation.
 *
 * The API refuses to boot on an invalid environment rather than failing later at
 * the first request. Spec section 20 forbids hardcoded secrets, so secrets have
 * no defaults here - a missing one is a startup error, not a silent fallback.
 */

const csv = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const booleanish = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    API_URL: z.string().url().default('http://localhost:3001'),
    WEB_URL: z.string().url().default('http://localhost:3000'),
    CORS_ORIGINS: z.string().default('http://localhost:3000').transform(csv),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    MFA_ENCRYPTION_KEY: z.string().min(32, 'MFA_ENCRYPTION_KEY must be at least 32 characters'),
    PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),

    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
    ENTRA_CLIENT_SECRET: z.string().optional(),

    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    // memory keeps counters in-process (fine for a single instance); redis shares
    // them across instances so the limit holds behind a load balancer.
    RATE_LIMIT_STORAGE: z.enum(['memory', 'redis']).default('memory'),

    // Reference-data cache. memory is per-process; redis is shared and survives
    // a restart. Both honour CACHE_TTL_SECONDS.
    CACHE_PROVIDER: z.enum(['memory', 'redis']).default('memory'),
    CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),

    STORAGE_PROVIDER: z.enum(['local', 'azure', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('.local-storage'),
    STORAGE_CONTAINER: z.string().default('techpioasset'),
    STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(25),
    ALLOWED_UPLOAD_MIME: z
      .string()
      .default('application/pdf,image/jpeg,image/png,image/heic')
      .transform(csv),

    AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    AI_PROVIDER: z.enum(['mock', 'azure']).default('mock'),
    AI_ENABLED: booleanish.default('false'),
    AZURE_DOC_INTELLIGENCE_ENDPOINT: z.string().optional(),
    AZURE_DOC_INTELLIGENCE_KEY: z.string().optional(),
    AI_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
    AI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).optional(),

    MAIL_PROVIDER: z.enum(['mock', 'smtp']).default('mock'),
    MAIL_FROM: z.string().default('TechpioAsset <no-reply@techpioasset.local>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_SECURE: booleanish.default('false'),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    // in-process runs jobs in this process (no Redis required, not durable);
    // bullmq uses REDIS_URL and survives restarts.
    QUEUE_PROVIDER: z.enum(['in-process', 'bullmq']).default('in-process'),

    PUSH_PROVIDER: z.enum(['mock', 'expo']).default('mock'),
    EXPO_ACCESS_TOKEN: z.string().optional(),

    // mock | webhook — optional Teams/Slack chat integration (spec section 19).
    CHAT_PROVIDER: z.enum(['mock', 'webhook']).default('mock'),
    TEAMS_WEBHOOK_URL: z.string().optional(),
    SLACK_WEBHOOK_URL: z.string().optional(),
    /** Runs the warranty/maintenance alert sweep on boot and daily. */
    ENABLE_SCHEDULED_JOBS: z
      .enum(['true', 'false', '1', '0'])
      .default('false')
      .transform((v) => v === 'true' || v === '1'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_REDACT_KEYS: z
      .string()
      .default(
        'password,passwordHash,token,accessToken,refreshToken,mfaSecret,authorization,cookie',
      )
      .transform(csv),
  })
  // Selecting a real provider without its credentials would fail at the first
  // upload or extraction instead of at boot. Catch it here.
  .superRefine((env, ctx) => {
    if (env.STORAGE_PROVIDER === 'azure' && !env.AZURE_STORAGE_CONNECTION_STRING) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AZURE_STORAGE_CONNECTION_STRING'],
        message: 'Required when STORAGE_PROVIDER=azure',
      });
    }
    if (env.STORAGE_PROVIDER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET and S3_REGION are required when STORAGE_PROVIDER=s3',
      });
    }
    if (
      env.AI_PROVIDER === 'azure' &&
      (!env.AZURE_DOC_INTELLIGENCE_ENDPOINT || !env.AZURE_DOC_INTELLIGENCE_KEY)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AZURE_DOC_INTELLIGENCE_ENDPOINT'],
        message: 'Endpoint and key are required when AI_PROVIDER=azure',
      });
    }
    if (env.QUEUE_PROVIDER === 'bullmq' && !env.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'Required when QUEUE_PROVIDER=bullmq',
      });
    }
    if (env.MAIL_PROVIDER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'Required when MAIL_PROVIDER=smtp',
      });
    }
    if (env.PUSH_PROVIDER === 'expo' && !env.EXPO_ACCESS_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXPO_ACCESS_TOKEN'],
        message: 'Required when PUSH_PROVIDER=expo',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (
        env.JWT_ACCESS_SECRET.includes('dev-only') ||
        env.JWT_REFRESH_SECRET.includes('dev-only')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'Development secrets must not be used in production (spec section 25)',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return parsed.data;
}
