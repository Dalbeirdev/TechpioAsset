import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, UserStatus, VerificationPurpose } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import { resolveScope, type DataScope, type SystemRole } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { getRequestContext } from '../common/request-context.js';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MailProvider } from '../providers/mail/mail.provider.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

export interface LoginResult {
  kind: 'tokens';
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: AuthUser;
}

export interface MfaChallengeResult {
  kind: 'mfa-required';
}

const VERIFICATION_TTL_MINUTES = { EMAIL_VERIFICATION: 60 * 24, PASSWORD_RESET: 30 } as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    private readonly mail: MailProvider,
    private readonly config: AppConfig,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Login
  // ───────────────────────────────────────────────────────────────────────────

  async login(input: {
    email: string;
    password: string;
    mfaCode?: string;
  }): Promise<LoginResult | MfaChallengeResult> {
    const ctx = getRequestContext();
    const user = await this.prisma.client.user.findFirst({
      where: { email: input.email },
      include: { profile: true, roles: { include: { role: true } } },
    });

    // Every failure below returns the same message. Distinguishing "no such
    // account" from "wrong password" turns the login form into an account
    // enumeration oracle.
    const invalid = () =>
      new AppError('UNAUTHENTICATED', 'Email or password is incorrect', {
        detail: 'Email or password is incorrect.',
      });

    if (!user) {
      // Hash anyway so a missing account does not return measurably faster than
      // a wrong password.
      await this.passwords.verify(null, input.password);
      throw invalid();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.recordFailedLogin(user.id, user.companyId, 'ACCOUNT_LOCKED');
      throw new AppError('UNAUTHENTICATED', 'Account temporarily locked', {
        detail: `Too many failed attempts. Try again after ${user.lockedUntil.toISOString()}.`,
      });
    }

    const passwordValid = await this.passwords.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      await this.registerFailedAttempt(user.id, user.companyId, user.failedLoginCount);
      throw invalid();
    }

    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.DEACTIVATED) {
      await this.recordFailedLogin(user.id, user.companyId, `STATUS_${user.status}`);
      throw new AppError('FORBIDDEN', 'Account is not active', {
        detail: 'This account has been suspended. Contact an administrator.',
      });
    }

    // MFA is checked only after the password is proven, so the challenge itself
    // never reveals whether an email exists.
    if (user.mfaEnabledAt) {
      const secret = this.mfa.decryptSecret(user.mfaSecret);
      if (!secret) {
        this.logger.error(`User ${user.id} has MFA enabled but an undecryptable secret`);
        throw new AppError('INTERNAL_ERROR', 'Multi-factor configuration is invalid');
      }
      if (!input.mfaCode) return { kind: 'mfa-required' };
      if (!this.mfa.verifyCode(secret, input.mfaCode)) {
        await this.registerFailedAttempt(user.id, user.companyId, user.failedLoginCount);
        throw new AppError('UNAUTHENTICATED', 'Invalid verification code');
      }
    }

    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const authUser = await this.buildAuthUser(user.id);
    const issued = await this.tokens.issue({
      userId: user.id,
      companyId: user.companyId,
      permissions: authUser.permissions,
      scope: authUser.scope,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    });

    await this.audit.record({
      companyId: user.companyId,
      actorId: user.id,
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: user.id,
    });

    return {
      kind: 'tokens',
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      refreshToken: issued.refreshToken,
      user: authUser,
    };
  }

  private async registerFailedAttempt(
    userId: string,
    companyId: string,
    currentCount: number,
  ): Promise<void> {
    const max = this.config.get('LOGIN_MAX_ATTEMPTS');
    const next = currentCount + 1;
    const shouldLock = next >= max;

    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: next,
        lockedUntil: shouldLock
          ? new Date(Date.now() + this.config.get('LOGIN_LOCKOUT_MINUTES') * 60_000)
          : null,
      },
    });

    await this.recordFailedLogin(userId, companyId, shouldLock ? 'LOCKED_OUT' : 'BAD_CREDENTIALS');
  }

  private async recordFailedLogin(
    userId: string,
    companyId: string,
    reason: string,
  ): Promise<void> {
    await this.audit.record({
      companyId,
      actorId: userId,
      action: AuditAction.LOGIN_FAILED,
      entityType: 'User',
      entityId: userId,
      reason,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Session lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  async refresh(presentedToken: string) {
    const ctx = getRequestContext();
    const { record, familyId } = await this.tokens.rotate(presentedToken, {
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    });

    if (record.user.status !== UserStatus.ACTIVE) {
      await this.tokens.revokeFamily(familyId, 'USER_INACTIVE');
      throw new AppError('FORBIDDEN', 'Account is not active');
    }

    // Permissions are re-resolved on every refresh rather than copied from the
    // old token, so a role change takes effect within one access-token lifetime
    // instead of persisting for the whole refresh window.
    const authUser = await this.buildAuthUser(record.userId);
    const issued = await this.tokens.issue({
      userId: record.userId,
      companyId: record.user.companyId,
      permissions: authUser.permissions,
      scope: authUser.scope,
      familyId,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    });

    return {
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      refreshToken: issued.refreshToken,
      user: authUser,
    };
  }

  async logout(presentedToken: string | undefined, actor?: { id: string; companyId: string }) {
    if (presentedToken) await this.tokens.revokeByToken(presentedToken, 'LOGOUT');
    if (actor) {
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.LOGOUT,
        entityType: 'User',
        entityId: actor.id,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Verification tokens
  // ───────────────────────────────────────────────────────────────────────────

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issueVerificationToken(
    userId: string,
    purpose: VerificationPurpose,
  ): Promise<string> {
    // Any outstanding token of the same purpose is invalidated, so a reset link
    // cannot be resurrected by requesting a second one.
    await this.prisma.client.verificationToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');
    const minutes = VERIFICATION_TTL_MINUTES[purpose];
    await this.prisma.client.verificationToken.create({
      data: {
        userId,
        purpose,
        tokenHash: AuthService.hash(token),
        expiresAt: new Date(Date.now() + minutes * 60_000),
        ipAddress: getRequestContext()?.ipAddress,
      },
    });
    return token;
  }

  private async consumeVerificationToken(token: string, purpose: VerificationPurpose) {
    const record = await this.prisma.client.verificationToken.findUnique({
      where: { tokenHash: AuthService.hash(token) },
      include: { user: true },
    });

    if (!record || record.purpose !== purpose || record.consumedAt) {
      throw new AppError('VALIDATION_FAILED', 'This link is invalid or has already been used');
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new AppError('VALIDATION_FAILED', 'This link has expired');
    }

    await this.prisma.client.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return record;
  }

  /**
   * Always resolves, whether or not the address exists. Returning "no such user"
   * here would leak account existence to anyone with a form.
   */
  async requestPasswordReset(email: string): Promise<{ token?: string }> {
    const user = await this.prisma.client.user.findFirst({ where: { email } });
    if (!user) {
      this.logger.log(`Password reset requested for unknown address (suppressed)`);
      return {};
    }
    const token = await this.issueVerificationToken(user.id, 'PASSWORD_RESET');
    const link = `${this.config.get('WEB_URL')}/reset-password?token=${token}`;

    // Sent through the provider interface: real SMTP in production, an .eml file
    // on disk in development. A failure must not change the response, or the
    // difference between "sent" and "not sent" would leak whether the address
    // exists.
    try {
      await this.mail.send({
        to: user.email,
        subject: 'Reset your TechpioAsset password',
        text: [
          'Someone asked to reset the password for this TechpioAsset account.',
          '',
          `Reset it here: ${link}`,
          '',
          'The link is valid for 30 minutes and can be used once.',
          'If this was not you, no action is needed — the password is unchanged.',
        ].join('\n'),
      });
    } catch (error) {
      this.logger.error(`Password reset email failed to send: ${(error as Error).message}`);
    }

    // Outside production the token is also returned so the flow is testable
    // without opening the message. Never in production.
    return this.config.isProduction ? {} : { token };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.consumeVerificationToken(token, 'PASSWORD_RESET');
    await this.prisma.client.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await this.passwords.hash(newPassword),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    // A password reset must end every existing session; otherwise an attacker who
    // already holds a refresh token keeps access after the victim recovers.
    await this.tokens.revokeAllForUser(record.userId, 'PASSWORD_RESET');

    await this.audit.record({
      companyId: record.user.companyId,
      actorId: record.userId,
      action: AuditAction.PASSWORD_RESET,
      entityType: 'User',
      entityId: record.userId,
    });
  }

  async requestEmailVerification(userId: string): Promise<{ token?: string }> {
    const token = await this.issueVerificationToken(userId, 'EMAIL_VERIFICATION');
    return this.config.isProduction ? {} : { token };
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.consumeVerificationToken(token, 'EMAIL_VERIFICATION');
    await this.prisma.client.user.update({
      where: { id: record.userId },
      data: {
        emailVerifiedAt: new Date(),
        status: record.user.status === UserStatus.INVITED ? UserStatus.ACTIVE : record.user.status,
      },
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new AppError('UNAUTHENTICATED', 'Current password is incorrect');
    }
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(newPassword) },
    });
    await this.tokens.revokeAllForUser(userId, 'PASSWORD_CHANGED');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // MFA enrolment
  // ───────────────────────────────────────────────────────────────────────────

  async startMfaEnrolment(userId: string) {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabledAt) {
      throw new AppError('CONFLICT', 'Multi-factor authentication is already enabled');
    }
    const secret = this.mfa.generateSecret();
    // Stored but not yet enabled: enrolment only completes once the user proves
    // they can generate a code, so a mis-scanned QR cannot lock them out.
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { mfaSecret: this.mfa.encryptSecret(secret) },
    });
    return { secret, otpauthUrl: this.mfa.buildOtpauthUrl(user.email, secret) };
  }

  async confirmMfaEnrolment(userId: string, code: string): Promise<void> {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = this.mfa.decryptSecret(user.mfaSecret);
    if (!secret) throw new AppError('CONFLICT', 'Start multi-factor enrolment first');
    if (!this.mfa.verifyCode(secret, code)) {
      throw new AppError('UNAUTHENTICATED', 'Invalid verification code');
    }
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { mfaEnabledAt: new Date() },
    });
    await this.audit.record({
      companyId: user.companyId,
      actorId: userId,
      action: AuditAction.MFA_ENROLLED,
      entityType: 'User',
      entityId: userId,
    });
  }

  async disableMfa(userId: string, password: string, code: string): Promise<void> {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    // Both factors are required to remove the second factor, so a stolen session
    // alone cannot strip MFA off an account.
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new AppError('UNAUTHENTICATED', 'Password is incorrect');
    }
    const secret = this.mfa.decryptSecret(user.mfaSecret);
    if (!secret || !this.mfa.verifyCode(secret, code)) {
      throw new AppError('UNAUTHENTICATED', 'Invalid verification code');
    }
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabledAt: null },
    });
    await this.audit.record({
      companyId: user.companyId,
      actorId: userId,
      action: AuditAction.MFA_DISABLED,
      entityType: 'User',
      entityId: userId,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Session subject
  // ───────────────────────────────────────────────────────────────────────────

  /** Resolves roles, permissions and scope for a user. */
  async buildAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        profile: { include: { department: true, office: true } },
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });

    const permissions = new Set<string>();
    const roleKeys: string[] = [];
    const roleNames: string[] = [];
    for (const link of user.roles) {
      roleKeys.push(link.role.key);
      roleNames.push(link.role.name);
      for (const grant of link.role.permissions) permissions.add(grant.permission.key);
    }

    // Scope comes from the seeded system-role keys. A custom role that is not one
    // of the eight falls through to OWN - the safe default.
    const knownRoles = roleKeys.filter((key): key is SystemRole =>
      [
        'SUPER_ADMIN',
        'IT_ADMIN',
        'HR',
        'OFFICE_ADMIN',
        'FINANCE',
        'MANAGER',
        'EMPLOYEE',
        'AUDITOR',
      ].includes(key),
    );
    const scope: DataScope = knownRoles.length > 0 ? resolveScope(knownRoles) : 'OWN';

    return {
      id: user.id,
      email: user.email,
      companyId: user.companyId,
      firstName: user.profile?.firstName ?? null,
      lastName: user.profile?.lastName ?? null,
      displayName:
        user.profile?.displayName ??
        (user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : null),
      avatarUrl: user.profile?.avatarKey ?? null,
      jobTitle: user.profile?.jobTitle ?? null,
      departmentId: user.profile?.departmentId ?? null,
      departmentName: user.profile?.department?.name ?? null,
      officeId: user.profile?.officeId ?? null,
      officeName: user.profile?.office?.name ?? null,
      roles: roleKeys,
      roleNames,
      permissions: [...permissions],
      scope,
      mfaEnabled: user.mfaEnabledAt !== null,
    };
  }

  /** Constant-time compare, used where a caller supplies an opaque value. */
  static safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}
