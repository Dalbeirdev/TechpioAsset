import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, UserStatus, VerificationPurpose } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import {
  resolveScope,
  resolveEffectiveScope,
  SYSTEM_ROLES,
  type DataScope,
  type SystemRole,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { getRequestContext } from '../common/request-context.js';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MailProvider } from '../providers/mail/mail.provider.js';
import { NotificationsService } from '../notifications/notifications.service.js';
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

// INVITE lives 7 days: a reset link guards an existing account and must be
// short; an invite guards an empty one and must survive a weekend unopened.
const VERIFICATION_TTL_MINUTES = {
  EMAIL_VERIFICATION: 60 * 24,
  PASSWORD_RESET: 30,
  INVITE: 60 * 24 * 7,
} as const;

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
    private readonly notifications: NotificationsService,
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
      include: {
        profile: true,
        roles: { include: { role: true } },
        company: { select: { isActive: true } },
      },
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

    // v2.6 A4: a suspended TENANT blocks every login, whatever the user status.
    if (!user.company.isActive) {
      await this.recordFailedLogin(user.id, user.companyId, 'TENANT_SUSPENDED');
      throw new AppError('FORBIDDEN', 'This workspace is suspended', {
        detail: 'The company workspace has been suspended. Contact your provider.',
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

    // v2.24: the Super Admin account holds one session at a time. Revoked
    // before the new tokens are issued, so this sign-in is the only survivor -
    // every other device is signed out at its next refresh. The role is the
    // tenant's master key; two concurrent copies of it is one too many.
    if (user.roles.some((r) => r.role.key === 'SUPER_ADMIN')) {
      await this.tokens.revokeAllForUser(user.id, 'SUPER_ADMIN_SINGLE_SESSION');
    }

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

  /**
   * Completes a single sign-on: the external identity provider has already
   * authenticated the user, so here we only authorise. The email must map to an
   * existing, active account — SSO never provisions new users (spec: only
   * registered users). No password or MFA is checked; the IdP owns that.
   */
  async loginWithSso(input: { email: string; subject: string }): Promise<LoginResult> {
    const ctx = getRequestContext();
    const user = await this.prisma.client.user.findFirst({
      where: { email: input.email },
      include: { profile: true, roles: { include: { role: true } } },
    });

    if (!user) {
      throw new AppError('FORBIDDEN', 'No account is registered for this identity', {
        detail: 'Ask an administrator to create your account before signing in with SSO.',
      });
    }
    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.DEACTIVATED) {
      throw new AppError('FORBIDDEN', 'Account is not active', {
        detail: 'This account has been suspended. Contact an administrator.',
      });
    }

    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    // Same single-session rule as the password path: however the Super Admin
    // arrives, only one copy of the master key is ever live.
    if (user.roles.some((r) => r.role.key === 'SUPER_ADMIN')) {
      await this.tokens.revokeAllForUser(user.id, 'SUPER_ADMIN_SINGLE_SESSION');
    }

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
      newValues: { method: 'SSO', subject: input.subject },
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

  /** Issue a 7-day single-use invitation token for a freshly created account. */
  issueInviteToken(userId: string): Promise<string> {
    return this.issueVerificationToken(userId, 'INVITE');
  }

  /**
   * Accepting an invitation (v2.12): one step sets the password, verifies the
   * email (they are holding a link only that inbox received) and activates the
   * account. Only INVITED accounts qualify - an active account holding an old
   * invite link must use the reset flow, where the current password's guarantees
   * apply.
   */
  async acceptInvite(token: string, password: string): Promise<void> {
    const record = await this.consumeVerificationToken(token, 'INVITE');
    if (record.user.deletedAt) {
      throw new AppError('VALIDATION_FAILED', 'This link is invalid or has already been used');
    }
    if (record.user.status !== UserStatus.INVITED) {
      throw new AppError('CONFLICT', 'This invitation was already accepted', {
        detail: 'Sign in with your password, or use "Forgot password" if you have lost it.',
      });
    }
    await this.prisma.client.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await this.passwords.hash(password),
        status: UserStatus.ACTIVE,
        emailVerifiedAt: record.user.emailVerifiedAt ?? new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.audit.record({
      companyId: record.user.companyId,
      actorId: record.userId,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: record.userId,
      newValues: { status: 'ACTIVE', note: 'Invitation accepted' },
    });

    // v2.19: welcome the new user and tell the admins the invitation landed.
    // Best effort - a mail hiccup must never fail the activation itself.
    try {
      const detail = await this.prisma.client.user.findUnique({
        where: { id: record.userId },
        select: {
          email: true,
          profile: { select: { firstName: true, lastName: true } },
          company: { select: { name: true } },
        },
      });
      const firstName = detail?.profile?.firstName ?? 'there';
      const fullName = detail?.profile
        ? `${detail.profile.firstName} ${detail.profile.lastName}`
        : (detail?.email ?? 'A new user');

      await this.notifications.sendTransactional({
        companyId: record.user.companyId,
        type: 'USER_WELCOME',
        toEmail: record.user.email,
        toUserId: record.userId,
        recipientName: firstName,
        title: 'Welcome to PioAssets',
        body: 'Your PioAssets account is set up and ready.',
        linkPath: '/login',
        vars: {
          'user.first_name': firstName,
          'user.email': record.user.email,
          'company.name': detail?.company?.name ?? 'your company',
        },
        emailRows: [
          ['Sign-in email', record.user.email],
          ['Workspace', detail?.company?.name ?? '—'],
        ],
        entityType: 'User',
        entityId: record.userId,
      });

      await this.notifications.notifyRoles(
        record.user.companyId,
        {
          type: 'USER_ACTIVATED',
          title: 'User account activated',
          body: `${fullName} accepted their invitation and completed account setup.`,
          linkPath: `/people/${record.userId}`,
          vars: { 'subject.name': fullName },
          emailRows: [
            ['User', fullName],
            ['Email', record.user.email],
            ['Activated', new Date().toISOString().slice(0, 10)],
          ],
          entityType: 'User',
          entityId: record.userId,
        },
        { excludeUserIds: [record.userId] },
      );
    } catch (error) {
      this.logger.error(`Post-activation emails failed: ${(error as Error).message}`);
    }
  }

  /**
   * Always resolves, whether or not the address exists. Returning "no such user"
   * here would leak account existence to anyone with a form.
   */
  async requestPasswordReset(email: string): Promise<{ token?: string }> {
    const user = await this.prisma.client.user.findFirst({
      where: { email },
      include: { profile: { select: { firstName: true } } },
    });
    if (!user) {
      this.logger.log(`Password reset requested for unknown address (suppressed)`);
      return {};
    }
    const token = await this.issueVerificationToken(user.id, 'PASSWORD_RESET');

    // Sent through the notification engine (branded template + email log), but
    // with no in-app row and no preference gate. A failure must not change the
    // response, or the difference between "sent" and "not sent" would leak
    // whether the address exists.
    try {
      await this.notifications.sendTransactional({
        companyId: user.companyId,
        type: 'PASSWORD_RESET',
        toEmail: user.email,
        toUserId: user.id,
        recipientName: user.profile?.firstName ?? user.email,
        title: 'Reset your PioAssets password',
        body: 'Someone asked to reset the password for this PioAssets account.',
        linkPath: `/reset-password?token=${token}`,
        vars: { 'user.first_name': user.profile?.firstName ?? '' },
        emailRows: [
          ['Account', user.email],
          ['Link valid for', '30 minutes, single use'],
        ],
        entityType: 'User',
        entityId: user.id,
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

  /**
   * Re-authentication gate for sensitive pages. A live session is not proof
   * the account owner is at the keyboard - a walk-away laptop is. Verifying
   * the password here lets the web app hold security settings behind a
   * "confirm it's you" prompt without granting anything new server-side.
   */
  /**
   * Recent sign-in activity for the security page (v2.12).
   *
   * Read from the audit trail rather than a new table - LOGIN, LOGIN_FAILED
   * and LOGOUT have been recorded there all along, and the point of an
   * append-only trail is that it is the answer to this question. Always the
   * caller's own rows: there is no parameter to widen it, so this cannot
   * become a way to watch a colleague. Bounded at 50.
   */
  async loginHistory(actor: AuthUser) {
    const rows = await this.prisma.client.auditLog.findMany({
      where: {
        companyId: actor.companyId,
        actorId: actor.id,
        action: { in: [AuditAction.LOGIN, AuditAction.LOGIN_FAILED, AuditAction.LOGOUT] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, action: true, createdAt: true, ipAddress: true, userAgent: true },
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      at: row.createdAt.toISOString(),
      ipAddress: row.ipAddress ?? null,
      device: row.userAgent ?? null,
    }));
  }

  async confirmPassword(userId: string, password: string): Promise<void> {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new AppError('UNAUTHENTICATED', 'Password is incorrect');
    }
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

    // v2.19: a password change is a security event the owner must hear about -
    // if it wasn't them, this email is the only thing that tips them off.
    try {
      await this.notifications.notify({
        companyId: user.companyId,
        userId,
        type: 'SECURITY_ALERT',
        title: 'Your PioAssets password was changed',
        body: 'The password for your PioAssets account was just changed. If this was you, no action is needed. If not, reset your password immediately and contact your administrator.',
        linkPath: '/settings/security',
        emailRows: [
          ['Account', user.email],
          ['Changed at', new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'],
        ],
      });
    } catch (error) {
      this.logger.error(`Password-change alert failed: ${(error as Error).message}`);
    }
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

    // Scope comes from the seeded system-role keys. A custom role that is not a
    // known system role falls through to OWN - the safe default.
    const knownRoles = roleKeys.filter((key): key is SystemRole =>
      (SYSTEM_ROLES as readonly string[]).includes(key),
    );
    // v2.1 Workstream C: when RBAC_SCOPES is on, honour each assignment's scope
    // override (UserRole.scope); otherwise keep v1's role-default resolution.
    const scope: DataScope = this.config.get('RBAC_SCOPES')
      ? resolveEffectiveScope(
          user.roles.map((link) => ({
            roleKey: link.role.key,
            scopeOverride: (link.scope as DataScope | null) ?? null,
          })),
        )
      : knownRoles.length > 0
        ? resolveScope(knownRoles)
        : 'OWN';

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
      phone: user.profile?.phone ?? null,
      locale: user.profile?.locale ?? null,
      timezone: user.profile?.timezone ?? null,
      dateFormat: user.profile?.dateFormat ?? null,
      departmentId: user.profile?.departmentId ?? null,
      departmentName: user.profile?.department?.name ?? null,
      officeId: user.profile?.officeId ?? null,
      officeName: user.profile?.office?.name ?? null,
      roles: roleKeys,
      roleNames,
      permissions: [...permissions],
      // The link that decides whose rows a supplier user may touch. Null for
      // colleagues; vendorScopeFilter reads it on every vendor-scoped query.
      vendorId: user.vendorId ?? null,
      scope,
      mfaEnabled: user.mfaEnabledAt !== null,
      // Mirror of PlatformGuard's check, for navigation only - the guard
      // remains the authority on every platform endpoint.
      platformAdmin: this.config
        .get('PLATFORM_ADMIN_EMAILS')
        .split(',')
        .map((entry: string) => entry.trim().toLowerCase())
        .filter(Boolean)
        .includes(user.email.toLowerCase()),
    };
  }

  /** Constant-time compare, used where a caller supplies an opaque value. */
  static safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}
