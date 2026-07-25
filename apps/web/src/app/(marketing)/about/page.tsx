import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Compass, HeartHandshake, ShieldCheck, Target } from 'lucide-react';

export const metadata: Metadata = {
  title: 'About — TechpioAsset',
  description:
    'Why TechpioAsset exists: give IT and operations teams one trustworthy record of every asset they own.',
};

const VALUES = [
  {
    Icon: Target,
    title: 'One source of truth',
    body: 'Scattered spreadsheets and memory don’t scale. Every asset, person, and cost lives in one place that stays current.',
  },
  {
    Icon: ShieldCheck,
    title: 'Trust by design',
    body: 'Roles decide who sees what, prices are recorded once and locked, and every sensitive action is written to an audit log that can’t be edited.',
  },
  {
    Icon: Compass,
    title: 'Built for the daily job',
    body: 'The workflows match how IT and operations actually work — assign, transfer, repair, retire — rather than forcing a new process on you.',
  },
  {
    Icon: HeartHandshake,
    title: 'Yours to grow into',
    body: 'Start with the register you have today and add approvals, maintenance, and reporting as your team grows.',
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="border-b border-[var(--color-border)]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
            About us
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            We help teams know exactly what they own.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-[var(--color-content-muted)]">
            TechpioAsset was built by TechPio Services LLP for a simple reason: most growing
            organisations lose track of their equipment. Laptops move between people, warranties
            lapse, and no one can say what anything cost. We set out to fix that with one clear,
            trustworthy register — not another spreadsheet.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="grid gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Our mission</h2>
            <p className="mt-4 text-[var(--color-content-muted)]">
              Give every IT and operations team the confidence that comes from a single, accurate
              record: who holds each asset, what condition it’s in, what it cost, and when it needs
              attention.
            </p>
            <p className="mt-4 text-[var(--color-content-muted)]">
              That confidence turns into real outcomes — less equipment lost, warranties claimed on
              time, cleaner audits, and finance numbers everyone believes.
            </p>
          </div>
          <div className="grid gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-8">
            <Stat value="Purchase → retirement" label="Full lifecycle tracked for every asset" />
            <Stat value="Role-based" label="Who sees cost and who can approve is enforced" />
            <Stat value="Append-only" label="Audit trail that can never be rewritten" />
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">What we value</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {VALUES.map(({ Icon, title, body }) => (
              <div
                key={title}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
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
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20 text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Want to see it in action?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[var(--color-content-muted)]">
          We’re happy to walk your team through it and help you bring your register across.
        </p>
        <Link
          href="/contact"
          className="mt-7 inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]"
        >
          Get in touch <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </section>
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-l-2 border-[var(--color-brand)] pl-4">
      <p className="text-lg font-semibold tracking-tight">{value}</p>
      <p className="text-sm text-[var(--color-content-muted)]">{label}</p>
    </div>
  );
}
