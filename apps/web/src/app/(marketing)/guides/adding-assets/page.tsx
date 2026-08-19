import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  FileSpreadsheet,
  PackagePlus,
  ScanLine,
  ShoppingCart,
  Tags,
  UserCheck,
} from 'lucide-react';
import { HeroAccent, HeroBackdrop, HeroBadge } from '@/components/marketing/hero-backdrop';

/**
 * The four ways equipment gets into PioAssets.
 *
 * Replaces the "how assets are added" half of the old PDF. The type-driven
 * fields and the identity rules described here are the ones the form actually
 * applies - a phone is asked for its IMEI because its type says so, not because
 * somebody remembered to ask.
 */

export const metadata: Metadata = {
  title: 'Adding Assets',
  description:
    'The four ways equipment gets into PioAssets: one at a time, a spreadsheet import, a purchase order, or network discovery — and what to record so it stays findable.',
  openGraph: {
    title: 'Adding Assets | PioAssets',
    description:
      'Register equipment one at a time, import a spreadsheet, receive it from a purchase order, or let discovery find it.',
    url: 'https://pioassets.com/guides/adding-assets',
    siteName: 'PioAssets',
    type: 'article',
    images: [
      {
        url: 'https://pioassets.com/marketing/og-card.jpg',
        width: 1200,
        height: 630,
        alt: 'PioAssets — adding assets',
      },
    ],
  },
  alternates: { canonical: 'https://pioassets.com/guides/adding-assets' },
};

export default function AddingAssetsPage() {
  return (
    <div>
      <section className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="relative mx-auto max-w-3xl px-5 py-16 sm:py-20">
          <HeroBadge>Guide</HeroBadge>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl">
            Adding <HeroAccent>assets</HeroAccent>
          </h1>
          <p className="mt-5 text-lg text-white/80">
            Four ways equipment gets in, and what to record so it can be found again.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-5 pb-24">
        <Section icon={PackagePlus} title="One at a time">
          <p>
            <strong>Assets → Add asset.</strong> Choose the category and then the type, and the form
            changes to suit: a mobile phone is asked for an IMEI, a laptop for a serial number, a
            monitor for its size. Nothing asks a headset for its operating system.
          </p>
          <p>
            You can also do this from the phone app, which is usually where it belongs — the serial
            is printed on the box in tiny type, and the app can scan it rather than have somebody
            copy sixteen characters by hand.
          </p>
        </Section>

        <Section icon={Tags} title="What is worth recording">
          <Field name="Asset tag" required>
            Your own label for the thing, and how people will look it up. Keep one convention across
            the fleet.
          </Field>
          <Field name="Type">
            Not decoration: the type decides which fields you are asked for, which sections the
            asset shows, and whether it appears when somebody filters for “all monitors”. Equipment
            with no type set is findable only by name.
          </Field>
          <Field name="Serial number, IMEI, MAC address">
            Unique within your company, and checked — a second asset carrying the same handset IMEI
            is refused rather than quietly created. Record whichever ones the type asks for.
          </Field>
          <Field name="Brand and model">
            What it takes to recognise the device on a desk without opening it.
          </Field>
          <Field name="Purchase and warranty dates">
            What makes the warranty report worth reading. They can be filled in later.
          </Field>
        </Section>

        <Section icon={FileSpreadsheet} title="A spreadsheet, for a fleet you already own">
          <p>
            <strong>Assets → Import Excel.</strong> The usual way to start: most companies arrive
            with a spreadsheet that has been maintained for years. Import it, then correct it in
            place — a bad row can be edited, and a row that should never have existed can be deleted
            outright by a super admin rather than pretending the equipment was disposed of.
          </p>
          <Callout>
            Import what you have, not what you wish you had. Blank serial numbers are honest and
            fillable; invented ones are indistinguishable from real ones a year later.
          </Callout>
        </Section>

        <Section icon={ShoppingCart} title="From a purchase order">
          <p>
            Equipment bought through PioAssets arrives already described. An approved request
            becomes a purchase order; when the boxes turn up, receiving them creates the asset
            records with the supplier, price and dates already attached, and each individually
            tracked line becomes its own asset ready to be assigned.
          </p>
        </Section>

        <Section icon={ScanLine} title="Discovery, for machines that report themselves">
          <p>
            Computers running the agent report their own hardware, operating system, installed
            software and health. That is what fills the Hardware, OS &amp; Security, Software and
            Health sections on a laptop — and why a headset does not have them: a headset will never
            report anything, so it is not shown four sections that can only ever be empty.
          </p>
        </Section>

        <Section icon={UserCheck} title="Then give it to somebody">
          <p>
            An asset that nobody holds is inventory; an asset with a holder is accountability. Assign
            it from the asset itself, on the web or from the phone while you are standing next to the
            person. The recipient is asked to confirm receipt, and until they do, the record says
            the device left the store but nobody has said it arrived.
          </p>
        </Section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/guides/raising-a-request"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-contrast)]"
          >
            Raising a request <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            href="/guides"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-4 py-2.5 text-sm font-semibold"
          >
            All guides
          </Link>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof PackagePlus;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 border-t border-[var(--color-border)] pt-8 first:mt-0 first:border-0 first:pt-0">
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <Icon aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
        {title}
      </h2>
      <div className="mt-3 grid gap-3 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

function Field({
  name,
  required,
  children,
}: {
  name: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-3">
      <p className="text-sm font-semibold">
        {name}
        {required ? (
          <span className="ml-2 rounded-full bg-[var(--tone-critical-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--tone-critical-fg)]">
            required
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-sm text-[var(--color-content-muted)]">{children}</p>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-sm">
      {children}
    </p>
  );
}
