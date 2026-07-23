import { Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { AppConfig } from '../../config/config.module.js';
import { AppError } from '../../common/errors/app-error.js';
import { SsoProvider, type SsoProfile } from './sso.provider.js';

/**
 * Microsoft Entra ID (Azure AD) OIDC provider.
 *
 * Standard authorization-code flow: redirect to Entra's /authorize, then
 * exchange the returned code at /token and verify the id_token. The id_token
 * signature is checked against Entra's published JWKS, and the issuer, audience
 * and nonce are all validated — so a token minted for a different app, tenant,
 * or login attempt is rejected. The email it carries is mapped to an existing
 * local account by the auth service; SSO never provisions new users.
 */
export class EntraSsoProvider extends SsoProvider {
  readonly name = 'entra';
  readonly enabled = true;

  private readonly logger = new Logger(EntraSsoProvider.name);
  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: AppConfig) {
    super();
    const tenantId = config.get('ENTRA_TENANT_ID');
    const clientId = config.get('ENTRA_CLIENT_ID');
    const clientSecret = config.get('ENTRA_CLIENT_SECRET');
    if (!tenantId || !clientId || !clientSecret) {
      throw new Error(
        'Entra SSO requires ENTRA_TENANT_ID, ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET',
      );
    }
    this.tenantId = tenantId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
    );
    this.logger.log('Entra ID SSO enabled');
  }

  private get baseUrl(): string {
    return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0`;
  }

  private get issuer(): string {
    return `https://login.microsoftonline.com/${this.tenantId}/v2.0`;
  }

  authorizationUrl(input: { state: string; nonce: string; redirectUri: string }): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: input.redirectUri,
      response_mode: 'query',
      scope: 'openid profile email',
      state: input.state,
      nonce: input.nonce,
    });
    return `${this.baseUrl}/authorize?${params.toString()}`;
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
    nonce: string;
  }): Promise<SsoProfile> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      scope: 'openid profile email',
    });

    const response = await fetch(`${this.baseUrl}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      this.logger.warn(`Entra token exchange failed: ${response.status}`);
      throw new AppError('UNAUTHENTICATED', 'SSO sign-in failed');
    }

    const tokens = (await response.json()) as { id_token?: string };
    if (!tokens.id_token) throw new AppError('UNAUTHENTICATED', 'SSO returned no id_token');

    let payload: JWTPayload & {
      email?: string;
      preferred_username?: string;
      name?: string;
      oid?: string;
      nonce?: string;
    };
    try {
      ({ payload } = await jwtVerify(tokens.id_token, this.jwks, {
        audience: this.clientId,
        issuer: this.issuer,
      }));
    } catch {
      throw new AppError('UNAUTHENTICATED', 'SSO token could not be verified');
    }

    // Nonce binds this token to the login attempt that started here, defeating
    // token-replay and injection.
    if (payload.nonce !== input.nonce) {
      throw new AppError('UNAUTHENTICATED', 'SSO nonce mismatch');
    }

    const email = payload.email ?? payload.preferred_username;
    if (!email) throw new AppError('UNAUTHENTICATED', 'SSO identity has no email');

    return {
      email,
      subject: payload.oid ?? (payload.sub as string),
      name: payload.name,
    };
  }
}
