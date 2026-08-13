import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  Check,
  ClipboardCheck,
  LineChart,
  ScanLine,
  ShieldCheck,
  ShoppingBag,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { AssetMascotHero, AssetMascotWave } from '@/components/marketing/asset-mascot';

export const metadata: Metadata = {
  title: 'PioAssets — IT asset management for growing teams',
  description:
    'Track every laptop, licence, and asset from purchase to retirement. Assignments, approvals, maintenance, reports, and mobile scanning in one place.',
};

type Tint = 'blue' | 'green' | 'purple' | 'amber' | 'teal' | 'rose';

const TINT: Record<Tint, string> = {
  blue: 'bg-[var(--color-tint-blue)] text-[var(--color-tint-blue-fg)]',
  green: 'bg-[var(--color-tint-green)] text-[var(--color-tint-green-fg)]',
  purple: 'bg-[var(--color-tint-purple)] text-[var(--color-tint-purple-fg)]',
  amber: 'bg-[var(--color-tint-amber)] text-[var(--color-tint-amber-fg)]',
  teal: 'bg-[var(--color-tint-teal)] text-[var(--color-tint-teal-fg)]',
  rose: 'bg-[var(--color-tint-rose)] text-[var(--color-tint-rose-fg)]',
};

const FEATURES: { Icon: LucideIcon; tint: Tint; title: string; body: string }[] = [
  {
    Icon: Boxes,
    tint: 'blue',
    title: 'Full asset lifecycle',
    body: 'Register or bulk-import from a spreadsheet, then follow every item through assigned, in repair, retired, and disposed — with a strict, auditable status flow.',
  },
  {
    Icon: ClipboardCheck,
    tint: 'green',
    title: 'Requests & approvals',
    body: 'Employees request equipment; it routes automatically through manager, HR, IT, and finance — with a cost threshold that skips finance for small items.',
  },
  {
    Icon: Wrench,
    tint: 'purple',
    title: 'Maintenance & warranty',
    body: 'Log repairs, track downtime and service cost, and get warranty-expiry alerts before cover runs out — so nothing lapses unnoticed.',
  },
  {
    Icon: LineChart,
    tint: 'amber',
    title: 'Reports & spend',
    body: 'See total spend by category, depreciation, and inventory at a glance. Export any view to CSV or Excel, or schedule reports to your inbox.',
  },
  {
    Icon: ScanLine,
    tint: 'teal',
    title: 'Mobile & offline',
    body: 'Scan a QR or barcode to pull up an asset on the spot, confirm receipt, or run a stock-take that keeps working with no signal and syncs when it returns.',
  },
  {
    Icon: ShieldCheck,
    tint: 'rose',
    title: 'Roles & audit trail',
    body: 'Fine-grained roles decide who sees cost, who can price, and who can approve. Every sensitive action is recorded in an append-only audit log.',
  },
];

const STEPS = [
  {
    n: '1',
    title: 'Bring your data in',
    body: 'Import your existing register from Excel, or add assets one by one. Employees come along automatically.',
  },
  {
    n: '2',
    title: 'Assign to people',
    body: 'Hand equipment to employees, capture condition, and let them confirm receipt from their phone.',
  },
  {
    n: '3',
    title: 'Track & maintain',
    body: 'Transfers, repairs, and returns all update the record — and the history is never rewritten.',
  },
  {
    n: '4',
    title: 'Report & control cost',
    body: 'Know what you own, what it cost, and what needs attention, with reports finance can trust.',
  },
];

const primaryBtn =
  'inline-flex h-12 items-center gap-2 rounded-full bg-[var(--color-brand)] px-6 text-sm font-semibold text-[var(--color-brand-contrast)] transition-colors hover:bg-[var(--color-brand-hover)]';
const ghostBtn =
  'inline-flex h-12 items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-6 text-sm font-semibold transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]';

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[var(--color-border)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(46rem 26rem at 82% -12%, color-mix(in srgb, var(--color-brand) 14%, transparent), transparent 66%)',
          }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 sm:py-20 md:grid-cols-2 md:gap-14 md:py-24">
          <div>
            <span className="inline-block rounded-full bg-[var(--color-brand)]/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
              Manage assets. Control costs.
            </span>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance sm:text-5xl md:text-[3.4rem] md:leading-[1.05]">
              Every asset, <span className="text-[var(--color-brand)]">accounted for.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-[var(--color-content-muted)]">
              PioAssets tracks every laptop, licence, and piece of equipment from purchase to
              retirement — who has it, what it cost, and when it needs attention. One source of truth
              for IT, finance, and operations.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/login" className={primaryBtn}>
                Get started <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <Link href="/contact" className={ghostBtn}>
                Book a walkthrough
              </Link>
            </div>
            <div className="mt-7 flex max-w-md items-start gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <span
                className={`grid size-8 flex-none place-items-center rounded-lg ${TINT.blue}`}
              >
                <ShieldCheck aria-hidden="true" className="size-4" />
              </span>
              <p className="text-sm text-[var(--color-content-muted)]">
                <span className="font-semibold text-[var(--color-content)]">
                  No spreadsheets to wrangle.
                </span>{' '}
                Bring your register in and start tracking in minutes — we help you get set up.
              </p>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[540px]">
            <AssetMascotHero />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-20">
        <div className="max-w-2xl">
          <span className="inline-block rounded-full bg-[var(--color-brand)]/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
            What you get
          </span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
            Everything you need to run an asset register
          </h2>
          <p className="mt-3 text-[var(--color-content-muted)]">
            Purpose-built for the day-to-day of an IT or operations team — not a spreadsheet
            stretched past its limits.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ Icon, tint, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 transition-shadow hover:shadow-md"
            >
              <span className={`grid size-12 place-items-center rounded-2xl ${TINT[tint]}`}>
                <Icon aria-hidden="true" className="size-6" />
              </span>
              <h3 className="mt-4 text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-content-muted)]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* One record — split highlight */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="grid items-center gap-10 md:grid-cols-2 md:gap-14">
          <div>
            <span className="inline-block rounded-full bg-[var(--color-brand)]/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
              One record
            </span>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
              From purchase to retirement, the history is never rewritten.
            </h2>
            <p className="mt-4 text-[var(--color-content-muted)]">
              Transfers, repairs, and returns all update the same record — and every change is kept.
              Your finance team sees numbers they can trust; your auditors see a trail they can’t
              argue with.
            </p>
            <p className="mt-4 text-[var(--color-content-muted)]">
              Know who holds each asset, what condition it’s in, what it cost, and when it needs
              attention — without chasing four spreadsheets and three inboxes.
            </p>
          </div>
          <div
            className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-md"
            role="img"
            aria-label="Example asset lifecycle timeline for one laptop"
          >
            <LedgerRow
              Icon={ShoppingBag}
              tint="blue"
              title='Purchased · MacBook Pro 14"'
              detail="PIO-0421 · £1,899 · 3-yr warranty"
              pill="Logged"
              pillTint="blue"
            />
            <LedgerRow
              Icon={Check}
              tint="green"
              title="Assigned · A. Verma"
              detail="Receipt confirmed from mobile"
              pill="In use"
              pillTint="green"
              divider
            />
            <LedgerRow
              Icon={Wrench}
              tint="amber"
              title="Repaired · screen replacement"
              detail="2 days downtime · £180 · under warranty"
              pill="Serviced"
              pillTint="amber"
              divider
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how"
        className="border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]"
      >
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="max-w-2xl">
            <span className="inline-block rounded-full bg-[var(--color-brand)]/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
              How it works
            </span>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
              From a pile of laptops to a register finance trusts
            </h2>
            <p className="mt-3 text-[var(--color-content-muted)]">
              Four steps take you from scattered equipment to one accurate record.
            </p>
          </div>
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="grid size-12 place-items-center rounded-2xl bg-[var(--color-brand)] text-lg font-bold text-[var(--color-brand-contrast)] shadow-sm">
                  {s.n}
                </span>
                <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-content-muted)]">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div
          className="grid overflow-hidden rounded-3xl shadow-lg md:grid-cols-[1.25fr_0.75fr]"
          style={{ background: 'linear-gradient(130deg, #2563eb, #1d4ed8 60%, #1e3a8a)' }}
        >
          <div className="px-8 py-12 sm:px-10">
            <h2 className="text-2xl font-semibold tracking-tight text-balance text-white sm:text-3xl">
              Want to see what you own?
            </h2>
            <p className="mt-3 max-w-lg text-white/85">
              We’re happy to walk your team through it and help you bring your register across. It
              takes minutes to get started.
            </p>
            <Link
              href="/contact"
              className="mt-7 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#1d4ed8] transition-colors hover:bg-[#eef3ff]"
            >
              Get in touch <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <div className="grid place-items-center p-4">
            <AssetMascotWave />
          </div>
        </div>
      </section>
    </>
  );
}

function LedgerRow({
  Icon,
  tint,
  title,
  detail,
  pill,
  pillTint,
  divider = false,
}: {
  Icon: LucideIcon;
  tint: Tint;
  title: string;
  detail: string;
  pill: string;
  pillTint: Tint;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-4 p-4 ${divider ? 'border-t border-[var(--color-border)]' : ''}`}
    >
      <span className={`grid size-11 flex-none place-items-center rounded-xl ${TINT[tint]}`}>
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-[var(--color-content-muted)]">{detail}</p>
      </div>
      <span
        className={`ml-auto flex-none rounded-full px-3 py-1 text-xs font-semibold ${TINT[pillTint]}`}
      >
        {pill}
      </span>
    </div>
  );
}
