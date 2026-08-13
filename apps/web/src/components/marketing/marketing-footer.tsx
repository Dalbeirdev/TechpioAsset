import Link from 'next/link';
import { Boxes } from 'lucide-react';

/** Public footer with navigation and company detail. */
export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-2 md:grid-cols-4">
        <div className="sm:col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-[var(--color-brand)] text-[var(--color-brand-contrast)]">
              <Boxes aria-hidden="true" className="size-4" />
            </span>
            PioAssets
          </div>
          <p className="mt-3 max-w-xs text-sm text-[var(--color-content-muted)]">
            Track every laptop, licence, and asset from purchase to retirement — in one place.
          </p>
        </div>

        <FooterCol
          title="Product"
          links={[
            { href: '/', label: 'Overview' },
            { href: '/#features', label: 'Features' },
            { href: '/#how', label: 'How it works' },
            // A real file in public/docs, not a page - opens/downloads directly.
            { href: '/docs/user-guide.pdf', label: 'User guide (PDF)' },
            { href: '/login', label: 'Sign in' },
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            { href: '/about', label: 'About us' },
            { href: '/contact', label: 'Contact' },
          ]}
        />
        <FooterCol
          title="Get in touch"
          links={[{ href: 'mailto:proapps@techpio.com', label: 'proapps@techpio.com' }]}
        />
      </div>

      <div className="border-t border-[var(--color-border)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-5 text-xs text-[var(--color-content-subtle)] sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} TechPio Services LLP. All rights reserved.</p>
          <p>Built for IT and operations teams.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
        {title}
      </p>
      <ul className="mt-3 grid gap-2 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
