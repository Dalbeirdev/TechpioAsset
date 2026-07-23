/**
 * Single sign-on behind a provider interface (spec: optional Microsoft Entra ID
 * SSO, section 28 pattern).
 *
 * SSO is optional and off by default. When Entra credentials are configured the
 * real provider performs an OIDC authorization-code flow; otherwise a disabled
 * provider is wired whose `enabled` flag is false and whose methods refuse to
 * run, so the auth endpoints can 404 cleanly rather than half-working.
 */

export interface SsoProfile {
  /** The email the external identity maps to an existing local account by. */
  email: string;
  /** Stable external subject id (Entra `oid`/`sub`), for audit. */
  subject: string;
  name?: string;
}

export abstract class SsoProvider {
  abstract readonly name: string;
  /** False when SSO is not configured; the endpoints check this first. */
  abstract readonly enabled: boolean;

  /** The identity-provider URL to redirect the browser to. */
  abstract authorizationUrl(input: { state: string; nonce: string; redirectUri: string }): string;

  /**
   * Exchanges the authorization code for tokens, validates the id_token
   * (signature, issuer, audience, nonce), and returns the verified profile.
   */
  abstract exchangeCode(input: {
    code: string;
    redirectUri: string;
    nonce: string;
  }): Promise<SsoProfile>;
}
