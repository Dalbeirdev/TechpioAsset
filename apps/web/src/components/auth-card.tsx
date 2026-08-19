import Link from 'next/link';
import { Card } from '@/components/ui';
import { BrandLockup } from '@/components/brand';

/**
 * The shell the small account pages share - forgotten password, and setting a
 * new one. Same card, wordmark and centred heading as sign-in, without the
 * showcase panel: these are one-field pages reached from an email, not a
 * destination anybody browses to.
 */
export function AuthCard({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-sm">
        <Card className="p-6 sm:p-7">
          <div className="text-center">
            <Link href="/" aria-label="PioAssets home" className="inline-flex">
              <BrandLockup height={34} />
            </Link>
            <h1 className="mt-5 text-xl font-bold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-[var(--color-content-muted)]">{intro}</p>
          </div>
          {children}
        </Card>
        {footer ? (
          <div className="mt-4 text-center text-sm text-[var(--color-content-muted)]">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}

/** The shared error banner: same treatment as the one on sign-in. */
export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
      style={{
        color: 'var(--tone-critical-fg)',
        backgroundColor: 'var(--tone-critical-bg)',
        borderColor: 'var(--tone-critical-border)',
      }}
    >
      {children}
    </p>
  );
}
