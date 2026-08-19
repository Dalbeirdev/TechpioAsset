import { z } from 'zod';

/**
 * Authentication contracts (spec section 1).
 *
 * Password policy lives here rather than only on the server so the web and mobile
 * clients can give the same feedback before a round trip - but the server always
 * re-validates, because a client-side rule is a convenience, never a control.
 */

export const PASSWORD_MIN_LENGTH = 12;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200, 'Password must be at most 200 characters')
  .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter')
  .refine((v) => /[0-9]/.test(v), 'Password must contain a digit');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  /** Six-digit TOTP, supplied on the second call when MFA is enrolled. */
  mfaCode: z
    .string()
    .regex(/^\d{6}$/, 'Enter the 6-digit code')
    .optional(),
  /**
   * Keep this browser signed in after it is closed.
   *
   * Defaults to true, which is what every client did before the flag existed.
   * False makes the refresh cookie a session cookie, so a borrowed or shared
   * machine forgets the session when the browser closes. The server-side token
   * is unaffected either way - this only decides how long the browser keeps it.
   */
  remember: z.boolean().optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  companyId: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  jobTitle: z.string().nullable(),
  phone: z.string().nullable(),
  locale: z.string().nullable(),
  timezone: z.string().nullable(),
  dateFormat: z.string().nullable(),
  departmentId: z.string().nullable(),
  departmentName: z.string().nullable(),
  officeId: z.string().nullable(),
  officeName: z.string().nullable(),
  roles: z.array(z.string()),
  roleNames: z.array(z.string()),
  permissions: z.array(z.string()),
  scope: z.enum(['ALL', 'DEPARTMENT', 'DIRECT_REPORTS', 'OWN']),
  mfaEnabled: z.boolean(),
  /** Operator-designated (PLATFORM_ADMIN_EMAILS) - NOT a tenant permission.
   * Drives visibility of the platform console in the navigation only; every
   * platform endpoint re-checks the list server-side. */
  platformAdmin: z.boolean().default(false),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires; clients refresh ahead of this. */
  expiresIn: z.number().int().positive(),
  user: authUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * Returned instead of tokens when the account has MFA enrolled and no code was
 * supplied. Deliberately carries no user detail - it is sent before the second
 * factor has been proven.
 */
export const mfaRequiredResponseSchema = z.object({
  mfaRequired: z.literal(true),
});
export type MfaRequiredResponse = z.infer<typeof mfaRequiredResponseSchema>;

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(16),
  password: passwordSchema,
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const verifyEmailRequestSchema = z.object({ token: z.string().min(16) });

/** Re-authentication before a sensitive page (security settings). Proves the
 * person at the keyboard is the account owner, not just a live session. */
export const confirmPasswordRequestSchema = z.object({ password: z.string().min(1) }).strict();

/** Accepting an invitation: the invite token plus the password the new user
 * chooses. Activates the account and verifies the email in one step. */
export const acceptInviteRequestSchema = z
  .object({ token: z.string().min(16), password: passwordSchema })
  .strict();

/** One active sign-in session (a refresh-token family), for the security page. */
export const sessionSchema = z.object({
  id: z.string(),
  device: z.string().nullable(),
  ipAddress: z.string().nullable(),
  lastActiveAt: z.string(),
  createdAt: z.string(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof sessionSchema>;

export const mfaEnrolStartResponseSchema = z.object({
  /** Base32 shared secret, shown once so it can be typed in manually. */
  secret: z.string(),
  /** otpauth:// URI for QR rendering. */
  otpauthUrl: z.string(),
});

export const mfaEnrolConfirmRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const mfaDisableRequestSchema = z.object({
  password: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
