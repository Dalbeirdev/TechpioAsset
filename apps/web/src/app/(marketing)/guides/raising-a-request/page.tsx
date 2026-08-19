import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  HelpCircle,
  Laptop,
  ListChecks,
  Send,
  Smartphone,
  UserCog,
} from 'lucide-react';
import { REQUEST_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import type { RequestStatus } from '@techpioasset/domain';
import { HeroAccent, HeroBackdrop, HeroBadge } from '@/components/marketing/hero-backdrop';
import { StatusBadge } from '@/components/status-badge';

/**
 * How to raise a request, written for the person raising one.
 *
 * Kept as a page rather than a PDF: it describes behaviour that changes with
 * the product, and a PDF in a downloads folder goes stale silently. Every
 * status, type and rule here is the one the application actually applies -
 * where the two ever disagree, the application is right and this page is a bug.
 */

export const metadata: Metadata = {
  title: 'Raising a Request',
  description:
    'How to raise a request or ticket in PioAssets: where to start, what each field means, who approves it, what every status means, and how to follow it to completion.',
  openGraph: {
    title: 'Raising a Request | PioAssets',
    description:
      'A complete guide to creating a ticket in PioAssets — request types, the approval chain, every status explained, and what to do when a request stalls.',
    url: 'https://pioassets.com/guides/raising-a-request',
    siteName: 'PioAssets',
    type: 'article',
    images: [
      {
        url: 'https://pioassets.com/marketing/og-card.jpg',
        width: 1200,
        height: 630,
        alt: 'PioAssets — raising a request',
      },
    ],
  },
  alternates: { canonical: 'https://pioassets.com/guides/raising-a-request' },
};

const TYPES: { label: string; when: string }[] = [
  { label: 'Additional equipment', when: 'You need something you do not have yet.' },
  { label: 'Replacement', when: 'Something you hold needs swapping for another unit.' },
  { label: 'Upgrade', when: 'What you hold works, but you need a better specification.' },
  { label: 'Damaged item', when: 'Equipment has been damaged and needs attention.' },
  { label: 'Lost item', when: 'Equipment cannot be found.' },
  { label: 'Repair', when: 'Something is faulty but repairable.' },
  { label: 'Office / furniture', when: 'Desks, chairs and workplace items.' },
  { label: 'Kitchen / pantry', when: 'Pantry and kitchen supplies.' },
  { label: 'Accessibility', when: 'Equipment needed for an accessibility requirement.' },
  { label: 'Project requirement', when: 'Equipment for a specific project or client.' },
];

/**
 * Keyed to the application's own status tokens, so the badge printed here is
 * literally the badge on the request - a screenshot in prose goes stale, a
 * shared token cannot.
 */
const STATUSES: { key: RequestStatus; meaning: string; group: 'open' | 'decided' | 'fulfilling' }[] = [
  { key: 'DRAFT', meaning: 'Started but not submitted. Nobody can see it but you.', group: 'open' },
  { key: 'SUBMITTED', meaning: 'Received, about to enter its first review step.', group: 'open' },
  { key: 'MANAGER_APPROVAL_PENDING', meaning: 'With your line manager.', group: 'open' },
  { key: 'HR_REVIEW_PENDING', meaning: 'With the HR team.', group: 'open' },
  { key: 'IT_REVIEW_PENDING', meaning: 'With IT, usually to confirm what to issue.', group: 'open' },
  { key: 'OFFICE_ADMIN_REVIEW_PENDING', meaning: 'With the office administrator.', group: 'open' },
  { key: 'FINANCE_APPROVAL_PENDING', meaning: 'With finance, for the cost.', group: 'open' },
  { key: 'APPROVED', meaning: 'Every step agreed. It moves to fulfilment.', group: 'decided' },
  { key: 'REJECTED', meaning: 'Declined at one of the steps, with a reason on the request.', group: 'decided' },
  { key: 'CANCELLED', meaning: 'Withdrawn before a decision.', group: 'decided' },
  { key: 'INVENTORY_RESERVED', meaning: 'Held for you from existing stock.', group: 'fulfilling' },
  { key: 'ORDERED', meaning: 'Bought from a supplier.', group: 'fulfilling' },
  { key: 'RECEIVED', meaning: 'Arrived and booked in.', group: 'fulfilling' },
  { key: 'READY_FOR_ASSIGNMENT', meaning: 'Prepared and waiting to be handed over.', group: 'fulfilling' },
  { key: 'ASSIGNED', meaning: 'Issued to you. Confirm receipt when it reaches you.', group: 'fulfilling' },
  { key: 'COMPLETED', meaning: 'Finished. Nothing further is expected.', group: 'fulfilling' },
];

export default function RaisingARequestPage() {
  return (
    <div>
      <section className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="relative mx-auto max-w-3xl px-5 py-16 sm:py-20">
          <HeroBadge>Guide</HeroBadge>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl">
            Raising a <HeroAccent>request</HeroAccent>
          </h1>
          <p className="mt-5 text-lg text-white/80">
            Everything a request goes through — where to start it, what to write, who approves it,
            and what each status is telling you while you wait.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-5 pb-24">
        <Section icon={HelpCircle} title="Before you start: can you raise one?">
          <p>
            Some companies let anyone raise a request. Others route everything through IT and HR, so
            employees ask them and they raise it on that person&rsquo;s behalf. Your company chooses
            which, and a single person can be allowed or blocked individually.
          </p>
          <p>
            You do not have to guess. If raising is turned off for you, the buttons are not shown and
            the page says who to ask instead. If you can see a <strong>New request</strong> button,
            you can raise one.
          </p>
        </Section>

        <Section icon={Laptop} title="Where to start it">
          <p>There are three ways in, and they all reach the same form.</p>
          <ol className="mt-3 grid gap-3">
            <Step n={1} title="From the device itself — the shortest route">
              Open <strong>My assets</strong>. Every device you hold carries three buttons:{' '}
              <strong>Report issue</strong>, <strong>Replacement</strong> and{' '}
              <strong>Upgrade</strong>. They open the form with the type already chosen and the
              device filled in, so nobody types an asset tag by hand.
            </Step>
            <Step n={2} title="From Requests">
              Open <strong>Requests</strong> and choose <strong>New request</strong>. Use this when
              the request is not about a device you already hold — new equipment, furniture, pantry
              supplies.
            </Step>
            <Step n={3} title="From your phone">
              The PioAssets app has a <strong>Requests</strong> tab with the same form. Useful when
              the problem is in front of you and your laptop is not.
            </Step>
          </ol>
        </Section>

        <Section icon={AlertTriangle} title="Reporting a problem with equipment">
          <p>
            <strong>Report issue</strong> asks what is wrong rather than what type of request it is,
            and picks the type for you:
          </p>
          <ul className="mt-3 grid gap-1.5">
            {[
              'Laptop performance issue',
              'Display issue',
              'Keyboard / mouse issue',
              'Headset / camera issue',
              'Software issue',
              'Hardware damage',
              'Replacement request',
              'Other asset issue',
            ].map((label) => (
              <li key={label} className="flex items-start gap-2">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-brand)]" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3">
            Hardware damage is raised at <strong>High</strong> priority automatically; the rest start
            at Normal. You can change it.
          </p>
        </Section>

        <Section icon={ClipboardList} title="Choosing the right type">
          <p>Ten types, so the right people see it and the right questions are asked.</p>
          <dl className="mt-3 grid gap-2">
            {TYPES.map((t) => (
              <div
                key={t.label}
                className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-3"
              >
                <dt className="text-sm font-semibold">{t.label}</dt>
                <dd className="mt-0.5 text-sm text-[var(--color-content-muted)]">{t.when}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section icon={ListChecks} title="Filling it in">
          <Field name="Business reason" required>
            The one field that decides how quickly this moves. An approver who has never met you
            reads this and nothing else. &ldquo;Need a second monitor&rdquo; invites a question;
            &ldquo;Reviewing two documents side by side daily, currently switching windows
            constantly&rdquo; answers it.
          </Field>
          <Field name="Priority">
            Low, Normal, High or Urgent. Urgent means someone cannot work — it is not a way to move
            up the queue, and using it for everything makes it mean nothing.
          </Field>
          <Field name="Items">
            What you actually need, with quantities. Be specific about the model if it matters, and
            say so if it does not — &ldquo;any 24&Prime; monitor&rdquo; is easier to fulfil than a
            part number nobody stocks.
          </Field>
          <Field name="Required by">
            Optional. Use it when there is a real date — a client visit, a new starter, a return to
            office. Leave it empty otherwise.
          </Field>
          <Field name="About this device">
            Filled in for you when you started from a device. It tells the approver which machine
            this concerns without them having to look it up.
          </Field>
          <p className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-sm">
            <strong>Cost is not your job.</strong> Only finance roles can enter an estimated cost.
            Describe what you need; procurement prices it.
          </p>
        </Section>

        <Section icon={Send} title="What happens when you submit">
          <p>
            The request enters an approval chain your company configured. A step is either a role —
            HR, IT, Office, Finance — or your own line manager. Each step is decided in turn: the
            next reviewer only sees the request once the one before them has agreed, so nobody is
            asked to approve something that may still be rejected upstream.
          </p>
          <p>
            Approvers are notified by email and see it under <strong>Approvals</strong>. You get an
            email at each decision, and the request page shows exactly who it is with right now.
          </p>
          <p>
            One request per thing: if you already have an open request for the same item, the second
            is refused rather than quietly duplicated.
          </p>
        </Section>

        <Section icon={UserCog} title="Every status, in order">
          <p className="mb-3">
            These are the exact badges you will see on the request, so you can match what is on
            your screen to what it means.
          </p>
          {(['open', 'decided', 'fulfilling'] as const).map((group) => (
            <div key={group} className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                {group === 'open' ? 'Being decided' : group === 'decided' ? 'Decided' : 'Being fulfilled'}
              </p>
              <dl className="grid gap-2">
                {STATUSES.filter((s) => s.group === group).map((s) => (
                  <div key={s.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <dt>
                      <StatusBadge token={REQUEST_STATUS_TOKENS[s.key]} size="sm" />
                    </dt>
                    <dd className="text-sm text-[var(--color-content-muted)]">{s.meaning}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </Section>

        <Section icon={Smartphone} title="Following it, and what to do if it stalls">
          <p>
            Your requests are under <strong>Requests</strong> on the web and in the{' '}
            <strong>Requests</strong> tab on the phone. Open one to see the full approval chain: what
            has been decided, what is outstanding, and who it is sitting with.
          </p>
          <p>
            If a request has not moved, the request page names the person or role it is waiting on.
            When it says <strong>nobody can approve this right now</strong>, the chain is pointing at
            somebody who does not exist yet — most often a line manager has not been recorded, or no
            account holds the role that step needs. That is a configuration fix, not a delay: send
            the request number to whoever administers PioAssets for your company.
          </p>
          <p>
            You can cancel your own request at any point before it is decided, and add a comment to
            it at any time — a comment is usually faster than a new request.
          </p>
        </Section>

        <Section icon={CheckCircle2} title="When the equipment arrives">
          <p>
            Once it is issued to you the request reaches <strong>Assigned</strong> and the device
            appears under <strong>My assets</strong> with a prompt to confirm you received it.
            Confirming closes the loop for IT — until you do, their records say the device left the
            store but nobody has said it arrived.
          </p>
        </Section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-contrast)]"
          >
            Sign in and raise one <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-4 py-2.5 text-sm font-semibold"
          >
            How PioAssets works
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
  icon: typeof HelpCircle;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 border-t border-[var(--color-border)] pt-8 first:mt-0 first:border-0 first:pt-0">
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <Icon aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
        {title}
      </h2>
      <div className="mt-3 grid gap-3 text-[15px] leading-relaxed text-[var(--color-content)]">
        {children}
      </div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-brand)]/10 text-sm font-semibold text-[var(--color-brand)]">
        {n}
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">{children}</p>
      </div>
    </li>
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
