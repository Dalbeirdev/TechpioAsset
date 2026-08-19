import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, KeyRound, PackagePlus, Send, UserPlus } from 'lucide-react';
import { HeroAccent, HeroBackdrop, HeroBadge } from '@/components/marketing/hero-backdrop';

/**
 * The guides index.
 *
 * These replaced a PDF. A downloaded file cannot be corrected once it is on
 * someone's desktop, and the one this section grew out of had drifted far
 * enough to be misleading - it named the old domain and stated a permission
 * that no longer matched the product.
 */

export const metadata: Metadata = {
  title: 'Guides',
  description:
    'How to use PioAssets: raising a request, inviting people, what each role can do, and how assets are added.',
  openGraph: {
    title: 'PioAssets Guides',
    description:
      'Short, current guides for the people who use PioAssets every day — requests, people and roles, and adding assets.',
    url: 'https://pioassets.com/guides',
    siteName: 'PioAssets',
    type: 'website',
    images: [
      {
        url: 'https://pioassets.com/marketing/og-card.jpg',
        width: 1200,
        height: 630,
        alt: 'PioAssets guides',
      },
    ],
  },
  alternates: { canonical: 'https://pioassets.com/guides' },
};

const GUIDES = [
  {
    href: '/guides/raising-a-request',
    icon: Send,
    title: 'Raising a request',
    blurb:
      'Where to start one, what each field is for, who approves it, what every status means, and what to do when it stalls.',
    who: 'Everyone',
  },
  {
    href: '/guides/inviting-people',
    icon: UserPlus,
    title: 'Inviting people',
    blurb:
      'How an account comes into existence, who may invite whom, and what happens to someone’s equipment when they leave.',
    who: 'Admins and HR',
  },
  {
    href: '/guides/roles-and-permissions',
    icon: KeyRound,
    title: 'Roles and permissions',
    blurb:
      'All thirteen roles, what each is for, how much of the company it sees, and who can see what things cost.',
    who: 'Admins',
  },
  {
    href: '/guides/adding-assets',
    icon: PackagePlus,
    title: 'Adding assets',
    blurb:
      'The four ways equipment gets into PioAssets — one at a time, a spreadsheet, a purchase order, or discovery.',
    who: 'IT and admins',
  },
];

export default function GuidesIndexPage() {
  return (
    <div>
      <section className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="relative mx-auto max-w-3xl px-5 py-16 sm:py-20">
          <HeroBadge>Guides</HeroBadge>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl">
            How to <HeroAccent>use PioAssets</HeroAccent>
          </h1>
          <p className="mt-5 text-lg text-white/80">
            Short guides for the people who use it every day. Each one describes what the product
            does today, not what a downloaded copy said last quarter.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-5 py-14">
        <ul className="grid gap-3">
          {GUIDES.map(({ href, icon: Icon, title, blurb, who }) => (
            <li key={href}>
              <Link
                href={href}
                className="group flex gap-4 rounded-[var(--radius-card)] border border-[var(--color-border)] p-5 transition-colors hover:border-[var(--color-brand)]"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-brand)]/10">
                  <Icon aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
                </span>
                <span className="grid gap-1">
                  <span className="flex items-center gap-2">
                    <span className="text-base font-semibold">{title}</span>
                    <span className="rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-content-muted)]">
                      {who}
                    </span>
                  </span>
                  <span className="text-sm text-[var(--color-content-muted)]">{blurb}</span>
                  <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-[var(--color-brand)]">
                    Read it
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
