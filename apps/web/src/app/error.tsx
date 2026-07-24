'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui';

/**
 * Route-level error boundary. Catches render/runtime errors in any page so a
 * single failing component shows a recoverable message instead of a blank
 * screen. `reset` re-renders the segment; the Dashboard link is the escape hatch
 * if it keeps failing.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface it for logging/monitoring; the digest ties the client error to a
    // server log entry without exposing internals to the user.
    console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--tone-critical-bg)]">
          <AlertTriangle aria-hidden="true" className="size-6 text-[var(--tone-critical-fg)]" />
        </div>
        <h1 className="mt-4 text-lg font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-1.5 text-sm text-[var(--color-content-muted)]">
          This page hit an unexpected error. You can try again, or head back to your dashboard.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-[var(--color-content-subtle)]">
            Reference: {error.digest}
          </p>
        ) : null}
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={reset}>
            <RotateCcw aria-hidden="true" className="mr-1.5 size-4" />
            Try again
          </Button>
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-4 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
