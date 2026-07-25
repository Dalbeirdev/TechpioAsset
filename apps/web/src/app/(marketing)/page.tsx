import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  LineChart,
  ScanLine,
  ShieldCheck,
  Wrench,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'TechpioAsset — IT asset management for growing teams',
  description:
    'Track every laptop, licence, and asset from purchase to retirement. Assignments, approvals, maintenance, reports, and mobile scanning in one place.',
};

const FEATURES = [
  {
    Icon: Boxes,
    title: 'Full asset lifecycle',
    body: 'Register or bulk-import from a spreadsheet, then follow every item through assigned, in repair, retired, and disposed — with a strict, auditable status flow.',
  },
  {
    Icon: ClipboardCheck,
    title: 'Requests & approvals',
    body: 'Employees request equipment; it routes automatically through manager, HR, IT, and finance — with a cost threshold that skips finance for small items.',
  },
  {
    Icon: Wrench,
    title: 'Maintenance & warranty',
    body: 'Log repairs, track downtime and service cost, and get warranty-expiry alerts before cover runs out — so nothing lapses unnoticed.',
  },
  {
    Icon: LineChart,
    title: 'Reports & spend',
    body: 'See total spend by category, depreciation, and inventory at a glance. Export any view to CSV or Excel, or schedule reports to your inbox.',
  },
  {
    Icon: ScanLine,
    title: 'Mobile & offline',
    body: 'Scan a QR or barcode to pull up an asset on the spot, confirm receipt, or run a stock-take that keeps working with no signal and syncs when it returns.',
  },
  {
    Icon: ShieldCheck,
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

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[var(--color-border)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            background:
              'radial-gradient(60rem 30rem at 70% -10%, var(--color-brand), transparent 70%)',
          }}
        />
        <div className="relative mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <p className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-content-muted)]">
            <span className="size-1.5 rounded-full bg-[var(--color-brand)]" />
            IT & office asset management
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl md:text-6xl">
            Every asset, accounted for.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-[var(--color-content-muted)]">
            TechpioAsset tracks every laptop, licence, and piece of equipment from purchase to
            retirement — who has it, what it cost, and when it needs attention. One source of truth
            for IT, finance, and operations.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]"
            >
              Sign in <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex h-11 items-center rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-5 text-sm font-semibold hover:bg-[var(--color-surface-sunken)]"
            >
              Book a walkthrough
            </Link>
          </div>
          <p className="mt-4 text-sm text-[var(--color-content-subtle)]">
            Manage Assets. Control Costs. Simplify Operations.
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Everything you need to run an asset register
          </h2>
          <p className="mt-3 text-[var(--color-content-muted)]">
            Purpose-built for the day-to-day of an IT or operations team — not a spreadsheet
            stretched past its limits.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 transition-shadow hover:shadow-md"
            >
              <span className="grid size-10 place-items-center rounded-xl bg-[var(--color-surface-sunken)] text-[var(--color-brand)]">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-content-muted)]">
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section
        id="how"
        className="border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]"
      >
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
          <p className="mt-3 max-w-2xl text-[var(--color-content-muted)]">
            From a pile of laptops to a register your finance team trusts — in four steps.
          </p>
          <ol className="mt-10 grid gap-6 md:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="relative">
                <span className="font-mono text-3xl font-bold text-[var(--color-brand)] tabular-nums">
                  {s.n}
                </span>
                <h3 className="mt-2 text-[15px] font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-content-muted)]">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-14 text-center sm:px-12">
          <h2 className="mx-auto max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Ready to see what you own?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--color-content-muted)]">
            Bring your register in and start tracking in minutes. We'll help you get set up.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/login"
              className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]"
            >
              Get started <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex h-11 items-center rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-5 text-sm font-semibold hover:bg-[var(--color-surface-sunken)]"
            >
              Talk to us
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
