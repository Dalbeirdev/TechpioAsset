import Link from 'next/link';
import { Compass } from 'lucide-react';

/** Branded 404 for unknown routes, replacing Next.js's unstyled default. */
export default function NotFound() {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--color-surface-sunken)]">
          <Compass aria-hidden="true" className="size-6 text-[var(--color-content-muted)]" />
        </div>
        <p className="mt-4 font-mono text-sm font-semibold text-[var(--color-brand)]">404</p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Page not found</h1>
        <p className="mt-1.5 text-sm text-[var(--color-content-muted)]">
          The page you’re looking for doesn’t exist or may have moved.
        </p>
        <div className="mt-5 flex justify-center">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
