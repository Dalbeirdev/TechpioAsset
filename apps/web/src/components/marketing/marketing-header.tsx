'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { BrandLockup } from '@/components/brand';
import { cn } from '@/lib/cn';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About' },
  { href: '/features', label: 'Features' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/feedback', label: 'Client Feedback' },
  { href: '/contact', label: 'Contact' },
];

/**
 * Public marketing header: sticky, and it tightens once the page scrolls so
 * the chrome recedes behind the content. CTA pair per the conversion spec -
 * quiet Sign In, loud Get Started; both collapse into the mobile sheet.
 */
export function MarketingHeader() {
  const { status } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const authed = status === 'authenticated';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b bg-[var(--color-background)]/85 backdrop-blur transition-all',
        scrolled ? 'border-[var(--color-border)] shadow-sm' : 'border-transparent',
      )}
    >
      <div
        className={cn(
          'mx-auto flex max-w-6xl items-center gap-4 px-5 transition-all',
          scrolled ? 'h-14' : 'h-[4.25rem]',
        )}
      >
        {/* Sized to clear the actions on a 375px screen - at 32px tall the
            wordmark is exactly one pixel too wide and flex squeezes it. */}
        <Link href="/" className="inline-flex shrink-0 items-center" aria-label="PioAssets home">
          <BrandLockup height={scrolled ? 24 : 28} />
        </Link>

        <nav aria-label="Primary" className="ml-4 hidden items-center gap-0.5 lg:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                pathname === l.href && !l.href.includes('#')
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
            href="/login"
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-content-muted)] transition-colors hover:text-[var(--color-content)] sm:block"
          >
            {authed ? 'Dashboard' : 'Sign In'}
          </Link>
          <Link
            href={authed ? '/dashboard' : '/login'}
            className="hidden h-9 items-center rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-contrast)] transition-colors hover:bg-[var(--color-brand-hover)] sm:inline-flex"
          >
            Get Started
          </Link>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-lg border border-[var(--color-border-strong)] lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <nav aria-label="Mobile" className="border-t border-[var(--color-border)] px-5 py-3 lg:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)]"
            >
              {l.label}
            </Link>
          ))}
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[var(--color-border)] pt-3">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="inline-flex h-10 items-center justify-center rounded-full border border-[var(--color-border-strong)] text-sm font-semibold"
            >
              {authed ? 'Dashboard' : 'Sign In'}
            </Link>
            <Link
              href={authed ? '/dashboard' : '/login'}
              onClick={() => setOpen(false)}
              className="inline-flex h-10 items-center justify-center rounded-full bg-[var(--color-brand)] text-sm font-semibold text-[var(--color-brand-contrast)]"
            >
              Get Started
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
