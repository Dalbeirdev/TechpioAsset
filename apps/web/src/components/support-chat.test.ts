import { describe, expect, it } from 'vitest';
import { isPublicRoute } from './support-chat';

/**
 * The support widget is third-party script running in our own origin, so the
 * only thing standing between it and the staff directory is this predicate.
 * It is tested directly because the consequence of a wrong answer is not a
 * broken page - it is a working page that quietly exposes people's details.
 */

describe('where the support chat is allowed to load', () => {
  it('loads on the ways into the product', () => {
    // Somebody locked out of login is the likeliest reason to want a chat
    // widget at all, so these are the cases that matter most.
    expect(isPublicRoute('/login')).toBe(true);
    expect(isPublicRoute('/forgot-password')).toBe(true);
    expect(isPublicRoute('/reset-password')).toBe(true);
    expect(isPublicRoute('/accept-invite')).toBe(true);
  });

  it('loads on the marketing site, including the home page', () => {
    expect(isPublicRoute('/')).toBe(true);
    expect(isPublicRoute('/features')).toBe(true);
    expect(isPublicRoute('/how-it-works')).toBe(true);
    expect(isPublicRoute('/guides')).toBe(true);
    expect(isPublicRoute('/guides/adding-assets')).toBe(true);
  });

  it('carries a token or a nested segment through', () => {
    expect(isPublicRoute('/reset-password/abc123')).toBe(true);
    expect(isPublicRoute('/accept-invite/tok_xyz')).toBe(true);
  });

  it('never loads on a page showing staff or asset records', () => {
    // The failure this file exists to prevent.
    for (const route of [
      '/dashboard',
      '/people',
      '/people/usr_123',
      '/assets',
      '/assets/ast_9/receipt',
      '/reports',
      '/requests',
      '/audit',
      '/settings/roles',
      '/invoices',
    ]) {
      expect(isPublicRoute(route), `${route} must not load the widget`).toBe(false);
    }
  });

  it('treats the home page as exact, not as a prefix of everything', () => {
    // The bug this guards: '/' matched with startsWith puts the widget on every
    // page in the product, which is precisely what the allowlist is preventing.
    expect(isPublicRoute('/people')).toBe(false);
  });

  it('does not let a lookalike route in on a prefix match', () => {
    // '/loginhistory' starts with '/login' as a STRING but is a different
    // route; segment-aware matching is what keeps them apart.
    expect(isPublicRoute('/loginhistory')).toBe(false);
    expect(isPublicRoute('/features-internal')).toBe(false);
  });

  it('refuses an unknown route by default', () => {
    // A new authenticated screen must not acquire the widget by existing.
    expect(isPublicRoute('/something-added-next-quarter')).toBe(false);
    expect(isPublicRoute('')).toBe(false);
  });
});
