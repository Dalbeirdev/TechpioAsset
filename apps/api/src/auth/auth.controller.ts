import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  mfaDisableRequestSchema,
  mfaEnrolConfirmRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
  type AuthUser,
} from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { AppConfig } from '../config/config.module.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';
import { SsoProvider } from '../providers/sso/sso.provider.js';
import { CurrentUser, Public } from './decorators.js';

const REFRESH_COOKIE = 'techpioasset_refresh';
const SSO_STATE_COOKIE = 'techpioasset_sso_state';
const SSO_NONCE_COOKIE = 'techpioasset_sso_nonce';

/**
 * Login attempts per minute per IP. Far tighter than the global limit: this is
 * the endpoint an attacker brute-forces, and per-account lockout alone does not
 * stop credential stuffing spread across many accounts from one source.
 *
 * Configurable because the integration suite makes many legitimate logins in a
 * few seconds and would otherwise rate-limit itself.
 */
const LOGIN_ATTEMPTS_PER_MINUTE = Number(process.env.LOGIN_RATE_LIMIT ?? 10);

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
    private readonly sso: SsoProvider,
  ) {}

  /**
   * The refresh token lives in an httpOnly cookie so no script can read it, which
   * is what makes XSS unable to steal a long-lived credential. The access token
   * is returned in the body and held in memory by the client.
   */
  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: this.tokens.refreshTtlSeconds * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  private readRefreshCookie(req: Request): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: LOGIN_ATTEMPTS_PER_MINUTE, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Body(zodBody(loginRequestSchema)) body: { email: string; password: string; mfaCode?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body);
    if (result.kind === 'mfa-required') return { mfaRequired: true as const };

    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user };
  }

  /** Where Entra returns the browser after authenticating. */
  private ssoRedirectUri(): string {
    return `${this.config.get('API_URL')}/api/v1/auth/sso/entra/callback`;
  }

  /** The web app to land on after a successful SSO sign-in. */
  private webAppUrl(): string {
    return this.config.get('CORS_ORIGINS')[0] ?? this.config.get('API_URL');
  }

  @Get('sso/available')
  @Public()
  @ApiOperation({ summary: 'Whether single sign-on is configured' })
  ssoAvailable(): { enabled: boolean; provider: string } {
    return { enabled: this.sso.enabled, provider: this.sso.name };
  }

  @Get('sso/entra')
  @Public()
  @ApiOperation({ summary: 'Begin Microsoft Entra ID single sign-on' })
  ssoStart(@Res() res: Response): void {
    if (!this.sso.enabled) throw new AppError('NOT_FOUND', 'SSO is not enabled');

    // state defeats CSRF on the callback; nonce binds the id_token to this
    // attempt. Both are kept in short-lived httpOnly cookies, never a server store.
    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    const cookieOptions = {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax' as const,
      path: '/api/v1/auth',
      maxAge: 10 * 60 * 1000,
    };
    res.cookie(SSO_STATE_COOKIE, state, cookieOptions);
    res.cookie(SSO_NONCE_COOKIE, nonce, cookieOptions);
    res.redirect(this.sso.authorizationUrl({ state, nonce, redirectUri: this.ssoRedirectUri() }));
  }

  @Get('sso/entra/callback')
  @Public()
  @ApiOperation({ summary: 'Microsoft Entra ID SSO callback' })
  async ssoCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<void> {
    const cookies = req.cookies as Record<string, string> | undefined;
    const expectedState = cookies?.[SSO_STATE_COOKIE];
    const nonce = cookies?.[SSO_NONCE_COOKIE];
    // One-shot: clear the CSRF/nonce cookies whatever happens next.
    res.clearCookie(SSO_STATE_COOKIE, { path: '/api/v1/auth' });
    res.clearCookie(SSO_NONCE_COOKIE, { path: '/api/v1/auth' });

    if (!this.sso.enabled) throw new AppError('NOT_FOUND', 'SSO is not enabled');
    if (!code || !state || !expectedState || state !== expectedState || !nonce) {
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired SSO state');
    }

    const profile = await this.sso.exchangeCode({
      code,
      redirectUri: this.ssoRedirectUri(),
      nonce,
    });
    const result = await this.auth.loginWithSso({
      email: profile.email,
      subject: profile.subject,
    });

    // Same refresh-cookie handshake as password login: the web app's boot calls
    // /auth/refresh with this cookie and comes up authenticated.
    this.setRefreshCookie(res, result.refreshToken);
    res.redirect(this.webAppUrl());
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange a refresh token for a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const presented = this.readRefreshCookie(req);
    if (!presented) throw new AppError('UNAUTHENTICATED', 'No refresh token supplied');

    try {
      const result = await this.auth.refresh(presented);
      this.setRefreshCookie(res, result.refreshToken);
      return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user };
    } catch (error) {
      // A rejected refresh means the session is over; leaving the cookie in place
      // would make the client retry a token that can never work again.
      this.clearRefreshCookie(res);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthUser | undefined,
  ): Promise<void> {
    await this.auth.logout(
      this.readRefreshCookie(req),
      user ? { id: user.id, companyId: user.companyId } : undefined,
    );
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @ApiOperation({ summary: 'Current user, roles, permissions and scope' })
  @ApiOkResponse({ description: 'The authenticated subject.' })
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request a password reset',
    description:
      'Always returns 202 whether or not the address exists, so the endpoint cannot be used to ' +
      'discover which email addresses have accounts.',
  })
  async forgotPassword(
    @Body(zodBody(forgotPasswordRequestSchema)) body: { email: string },
  ): Promise<{ devToken?: string }> {
    const result = await this.auth.requestPasswordReset(body.email);
    // Outside production the token is returned so the flow is testable before the
    // mail provider lands in Phase 2. It is never present in production.
    return result.token ? { devToken: result.token } : {};
  }

  @Post('reset-password')
  @Public()
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Complete a password reset' })
  async resetPassword(
    @Body(zodBody(resetPasswordRequestSchema)) body: { token: string; password: string },
  ): Promise<void> {
    await this.auth.resetPassword(body.token, body.password);
  }

  @Post('verify-email')
  @Public()
  @HttpCode(204)
  @ApiOperation({ summary: 'Confirm an email address' })
  async verifyEmail(
    @Body(zodBody(verifyEmailRequestSchema)) body: { token: string },
  ): Promise<void> {
    await this.auth.verifyEmail(body.token);
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Change your own password' })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(changePasswordRequestSchema))
    body: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
  }

  @Post('mfa/enrol')
  @HttpCode(200)
  @ApiOperation({ summary: 'Begin multi-factor enrolment' })
  startMfa(@CurrentUser() user: AuthUser) {
    return this.auth.startMfaEnrolment(user.id);
  }

  @Post('mfa/confirm')
  @HttpCode(204)
  @ApiOperation({ summary: 'Confirm multi-factor enrolment with a code' })
  async confirmMfa(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(mfaEnrolConfirmRequestSchema)) body: { code: string },
  ): Promise<void> {
    await this.auth.confirmMfaEnrolment(user.id, body.code);
  }

  @Post('mfa/disable')
  @HttpCode(204)
  @ApiOperation({ summary: 'Disable multi-factor authentication' })
  async disableMfa(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(mfaDisableRequestSchema)) body: { password: string; code: string },
  ): Promise<void> {
    await this.auth.disableMfa(user.id, body.password, body.code);
  }
}
