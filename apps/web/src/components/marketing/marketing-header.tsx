'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Boxes, Menu, X } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/cn';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

/** Public marketing header. The primary CTA adapts to whether you're signed in. */
export function MarketingHeader() {
  const { status } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const authed = status === 'authenticated';

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-background)]/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-[var(--color-brand)] text-[var(--color-brand-contrast)]">
            <Boxes aria-hidden="true" className="size-5" />
          </span>
          PioAssets
        </Link>

        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium transition-colors',
                pathname === l.href
                  ? 'text-[var(--color-content)]'
                  : 'text-[var(--color-content-muted)] hover:text-[var(--color-content)]',
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link
            href={authed ? '/dashboard' : '/login'}
            className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]"
          >
            {authed ? 'Go to dashboard' : 'Sign in'}
          </Link>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-[var(--radius-control)] border border-[var(--color-border-strong)] md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <nav
          aria-label="Mobile"
          className="border-t border-[var(--color-border)] px-5 py-2 md:hidden"
        >
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-medium text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)]"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
