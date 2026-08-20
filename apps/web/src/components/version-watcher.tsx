'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Tells somebody when the app they are looking at has been superseded (v2.25).
 *
 * The app shell - sidebar, navigation, everything outside the page body - is
 * fetched once when a tab opens. Next then moves between pages without
 * refetching it, so a tab left open across a deploy keeps the old shell for as
 * long as it stays open: through navigation, and through signing out and back
 * in. New menu items simply do not appear, and nothing on screen suggests why.
 *
 * This does not reload anything by itself. Reloading a page somebody is typing
 * into, to fix a problem they have not noticed, trades one silent failure for a
 * worse one - so it offers, and they choose.
 */

/** Quiet enough to be invisible, frequent enough that nobody sits on a stale
 *  build for a working day. */
const POLL_MS = 10 * 60 * 1000;

async function fetchBuild(): Promise<string | null> {
  try {
    const res = await fetch('/version', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { build?: string };
    return body.build ?? null;
  } catch {
    // Offline, or the server is mid-restart. Not knowing is not news.
    return null;
  }
}

export function VersionWatcher() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let loaded: string | null = null;
    let cancelled = false;

    const check = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      const current = await fetchBuild();
      if (cancelled || current === null) return;
      if (loaded === null) {
        loaded = current;
        return;
      }
      if (current !== loaded) setStale(true);
    };

    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    // Coming back to a tab is the moment somebody is most likely to have been
    // away across a deploy, and the cheapest time to find out.
    const onFocus = () => void check();
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (!stale) return null;

  return (
    <div
      role="status"
      className="print-hidden fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-4 py-3 shadow-[0_-4px_20px_-8px_rgba(15,23,42,0.35)]"
    >
      <p className="text-sm">
        <span className="font-medium">A new version of PioAssets is available.</span>{' '}
        <span className="text-[var(--color-content-muted)]">
          Reload to pick up the latest changes — anything you are part-way through typing will be
          lost.
        </span>
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-3 py-1.5 text-sm font-semibold text-[var(--color-brand-contrast)]"
      >
        <RefreshCw aria-hidden="true" className="size-3.5" />
        Reload
      </button>
    </div>
  );
}
