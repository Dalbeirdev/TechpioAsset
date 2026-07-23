import { SsoProvider, type SsoProfile } from './sso.provider.js';

/**
 * Wired when no SSO credentials are configured. `enabled` is false so the auth
 * endpoints return 404; the methods throw as a backstop in case one is reached.
 */
export class DisabledSsoProvider extends SsoProvider {
  readonly name = 'disabled';
  readonly enabled = false;

  authorizationUrl(): string {
    throw new Error('SSO is not configured');
  }

  exchangeCode(): Promise<SsoProfile> {
    throw new Error('SSO is not configured');
  }
}
