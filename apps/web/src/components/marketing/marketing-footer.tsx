import Link from 'next/link';
import { BrandLockup } from '@/components/brand';

/** Public footer: brand, tagline, LLP credit and the site map. */
export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-5">
        <div className="sm:col-span-2">
          <BrandLockup height={30} />
          <p className="mt-3 max-w-xs text-sm font-medium">
            Know every asset. Control every lifecycle.
          </p>
          <p className="mt-2 max-w-xs text-sm text-[var(--color-content-muted)]">
            IT Asset Lifecycle Management — discover, register, track, assign, maintain, audit and
            retire IT assets in one platform.
          </p>
          <p className="mt-4 text-xs text-[var(--color-content-subtle)]">
            Created by TechPIO Services LLP
          </p>
        </div>

        <FooterCol
          title="Product"
          links={[
            { href: '/', label: 'Overview' },
            { href: '/features', label: 'Features' },
            { href: '/how-it-works', label: 'How It Works' },
            { href: '/feedback', label: 'Client Feedback' },
            { href: '/#security', label: 'Security' },
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            { href: '/about', label: 'About' },
            { href: '/about', label: 'TechPIO Services LLP' },
            { href: '/contact', label: 'Contact' },
          ]}
        />
        <FooterCol
          title="Resources"
          links={[
            { href: '/docs/user-guide.pdf', label: 'Documentation' },
            { href: '/login', label: 'Sign in' },
            { href: 'mailto:dalbeir@techpio.com', label: 'dalbeir@techpio.com' },
          ]}
        />
      </div>

      <div className="border-t border-[var(--color-border)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-5 text-xs text-[var(--color-content-subtle)] sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} TechPIO Services LLP. All rights reserved.</p>
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
