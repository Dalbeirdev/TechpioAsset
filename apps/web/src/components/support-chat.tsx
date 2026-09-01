'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';

/**
 * The PioTrack support chat, on public pages only (v2.31).
 *
 * WHY AN ALLOWLIST AND NOT AN EXCLUSION
 *
 * The obvious implementation is "load everywhere except the signed-in app".
 * That is one forgotten prefix away from putting a third-party script on a page
 * showing staff names, emails, phone numbers and who holds which laptop - and
 * the failure is silent, because the widget would look like it was working
 * exactly as intended.
 *
 * So the rule is inverted: a route gets the widget only by being named here.
 * A new authenticated screen cannot acquire it by accident; a new public one
 * has to be added deliberately, which is the direction the mistake should run.
 *
 * The script is third-party and loads into the page's own origin, so it can
 * read the DOM and browser storage of any page it runs on. On /login that is a
 * form; on /people it would be the staff directory.
 */

/**
 * Public routes, matched as prefixes.
 *
 * `/` is exact-matched - as a prefix it would match every route in the app.
 */
const PUBLIC_PREFIXES = [
  // Marketing.
  '/about',
  '/contact',
  '/features',
  '/feedback',
  '/guides',
  '/how-it-works',
  // Ways in. A person locked out of login is the likeliest reason this widget
  // exists at all, so these matter more than the marketing pages do.
  '/login',
  '/forgot-password',
  '/reset-password',
  '/accept-invite',
];

const WIDGET_SRC = 'https://piotrack.com:8443/widget/piotrack-chat.js';
const WIDGET_ID = 'wc_gsrzx7yeiqu6x0ddp7ff7lrp';

/**
 * Cross from a public page into the signed-in app with a FULL page load.
 *
 * A third-party script cannot be unloaded once it has run. This one appends its
 * UI as a sibling of the React root, so unmounting the component below removes
 * nothing: the widget would keep running straight through a client-side
 * navigation from /login into the dashboard - which is exactly the page the
 * allowlist exists to keep it off.
 *
 * A fresh document is the only reliable teardown. It costs one reload at the
 * sign-in boundary, which is a good place for one anyway: nothing accumulated
 * before authentication survives into the session.
 */
export function leaveForApp(path = '/dashboard'): void {
  window.location.replace(path);
}

export function isPublicRoute(pathname: string): boolean {
  if (pathname === '/') return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function SupportChat() {
  const pathname = usePathname();
  if (!isPublicRoute(pathname ?? '')) return null;

  return (
    <Script
      src={WIDGET_SRC}
      data-widget={WIDGET_ID}
      // afterInteractive rather than the snippet's plain `async`: the page is
      // rendered by Next, and a support widget must never compete with the
      // login form for the main thread.
      strategy="afterInteractive"
    />
  );
}
