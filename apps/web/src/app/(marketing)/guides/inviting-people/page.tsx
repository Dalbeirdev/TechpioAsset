import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, KeyRound, LogIn, MailCheck, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import { HeroAccent, HeroBackdrop, HeroBadge } from '@/components/marketing/hero-backdrop';

/**
 * How somebody gets an account, and what happens when they leave.
 *
 * Replaces the registration half of the old PDF guide. The invitation flow, the
 * restriction on which roles HR may grant, and the refusal to delete somebody
 * still holding equipment are all behaviours the server enforces - they are
 * written here as rules, not as suggestions.
 */

export const metadata: Metadata = {
  title: 'Inviting People',
  description:
    'How accounts are created in PioAssets: invitations, who may invite whom, single sign-on, and what happens to equipment when somebody leaves.',
  openGraph: {
    title: 'Inviting People | PioAssets',
    description:
      'Invitation-only by design. How to invite a colleague, which roles HR may grant, and how offboarding protects the equipment record.',
    url: 'https://pioassets.com/guides/inviting-people',
    siteName: 'PioAssets',
    type: 'article',
    images: [
      {
        url: 'https://pioassets.com/marketing/og-card.jpg',
        width: 1200,
        height: 630,
        alt: 'PioAssets — inviting people',
      },
    ],
  },
  alternates: { canonical: 'https://pioassets.com/guides/inviting-people' },
};

export default function InvitingPeoplePage() {
  return (
    <div>
      <section className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="relative mx-auto max-w-3xl px-5 py-16 sm:py-20">
          <HeroBadge>Guide</HeroBadge>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl">
            Inviting <HeroAccent>people</HeroAccent>
          </h1>
          <p className="mt-5 text-lg text-white/80">
            How an account comes into existence, who may invite whom, and what happens to somebody’s
            equipment when they leave.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-5 pb-24">
        <Section icon={ShieldCheck} title="There is no public sign-up">
          <p>
            PioAssets is invitation-only by design. Nobody outside your company can create an
            account on your tenant, however they arrive at the site. Every account is either invited
            by somebody who already has one, or provisioned by your identity provider.
          </p>
        </Section>

        <Section icon={UserPlus} title="Inviting a colleague">
          <p>
            <strong>Who can:</strong> Super Admin and Company Admin, and HR.{' '}
            <strong>HR may invite Registered Employees only</strong> — registering a joiner is HR
            work, granting privileged roles is not, and the server refuses any other role on an HR
            invitation rather than trusting the form.
          </p>
          <ol className="mt-3 grid gap-3">
            <Step n={1} title="Open People">
              Under the Administration group. If you cannot see it, your role does not include it.
            </Step>
            <Step n={2} title="Invite, and fill in who they are">
              Name and work email. Department and office matter more than they look: department
              drives what a person can see under a department scope, and office is where their
              equipment is counted.
            </Step>
            <Step n={3} title="Tick their roles">
              One or more. If the combination is one that undermines a separation of duties, you
              will be asked to acknowledge it deliberately.
            </Step>
            <Step n={4} title="Send it">
              They receive an email with a link to set their own password. You never see or set it —
              a password somebody else typed is not a password.
            </Step>
            <Step n={5} title="They sign in">
              The link takes them to pioassets.com, they choose a password, and the account becomes
              active. Until then it sits as invited.
            </Step>
          </ol>
          <Callout>
            An invitation that goes unanswered is chased automatically — reminders go out on a
            schedule, and the invitation itself expires rather than staying valid indefinitely.
          </Callout>
        </Section>

        <Section icon={LogIn} title="Single sign-on">
          <p>
            If your company uses Microsoft Entra, people can sign in with their work account instead
            of a PioAssets password, and an account is created on first sign-in with the default
            employee role. Anything beyond that is granted deliberately in People — an identity
            provider proves who somebody is, not what they should be allowed to do.
          </p>
        </Section>

        <Section icon={KeyRound} title="Changing what somebody can do">
          <p>
            Open <strong>People</strong>, choose the person, adjust their roles and save. It takes
            effect on their next action. What each role can do is set out in{' '}
            <Link href="/guides/roles-and-permissions" className="text-[var(--color-brand)]">
              Roles and permissions
            </Link>
            .
          </p>
        </Section>

        <Section icon={UserMinus} title="When somebody leaves">
          <p>
            Deactivating an account stops the person signing in while keeping everything they were
            part of: their equipment history, the requests they raised, the approvals they gave.
          </p>
          <p>
            <strong>Deleting is refused while equipment is still assigned to them.</strong> That is
            deliberate. A deletion that quietly orphaned three laptops would leave the fleet wrong
            in a way nobody would notice for months. Take the equipment back first — which is a
            record of who returned what, in what condition — and then delete.
          </p>
          <p>
            A deleted account disappears from the directory and can never sign in again, but its
            assignment history and audit trail remain, because they are facts about equipment rather
            than about the person.
          </p>
        </Section>

        <Section icon={MailCheck} title="If an invitation does not arrive">
          <p>
            Check the spam folder first, then whether your mail system quarantined it. An
            administrator can see exactly what was sent, and when, under notification settings — an
            invitation that was never delivered looks identical to one that was ignored until you
            look there.
          </p>
        </Section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/guides/roles-and-permissions"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-contrast)]"
          >
            Roles and permissions <ArrowRight aria-hidden="true" className="size-4" />
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
  icon: typeof UserPlus;
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

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-sm">
      {children}
    </p>
  );
}
