'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * How old the agent's data is, said plainly (v2.38).
 *
 * Everything on the hardware, OS and health tabs is a snapshot from the last
 * time the machine checked in. Until now that was footnoted underneath in grey,
 * as an absolute date - which reads as provenance, not as a warning, and an
 * absolute date is the one format that makes staleness hard to judge. "26 Aug"
 * looks like a fact; "8 days ago" looks like a problem.
 *
 * This matters more than it sounds. Twenty-one of this company's thirty-four
 * agents stopped reporting on one evening in August and nobody noticed for a
 * week, because a machine last seen in August looked exactly like one seen an
 * hour ago. The data was not wrong; it was old, and nothing said so.
 *
 * So the stamp now leads the panel rather than trailing it - you learn the age
 * of what you are reading before you read it - and it changes tone as it ages.
 */

/** Past this, a machine has almost certainly stopped reporting rather than being off for the weekend. */
const STALE_DAYS = 7;
/** Past this it is worth a glance, but a laptop off over a weekend is normal. */
const AGEING_DAYS = 2;

function daysSince(at: string): number {
  return (Date.now() - new Date(at).getTime()) / 86_400_000;
}

/** "3 hours ago", "8 days ago" - the form that makes age obvious at a glance. */
export function relativeAge(at: string): string {
  const days = daysSince(at);
  if (days < 1 / 24) return 'just now';
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const whole = Math.round(days);
  return `${whole} day${whole === 1 ? '' : 's'} ago`;
}

export function ReportedFreshness({ source, at }: { source: string; at: string }) {
  const days = daysSince(at);
  const stale = days >= STALE_DAYS;
  const ageing = !stale && days >= AGEING_DAYS;

  const exact = new Date(at).toLocaleString();
  const who = source.toLowerCase();

  if (stale) {
    return (
      <div
        className="mb-4 flex items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2.5 text-sm"
        style={{
          color: 'var(--tone-warning-fg)',
          backgroundColor: 'var(--tone-warning-bg)',
          borderColor: 'var(--tone-warning-border)',
        }}
      >
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 flex-none" />
        <p>
          <span className="font-medium">
            This machine last reported {relativeAge(at)}.
          </span>{' '}
          What follows is a snapshot from {exact}, not its current state — the {who} has stopped
          checking in, so anything changed since then is not shown here.
        </p>
      </div>
    );
  }

  return (
    <p
      className={`mb-4 flex items-center gap-1.5 text-xs ${
        ageing ? 'text-[var(--tone-warning-fg)]' : 'text-[var(--color-content-subtle)]'
      }`}
    >
      <RefreshCw aria-hidden="true" className="size-3.5" />
      {/* Relative first because that is the part being judged; the exact time
          follows for anyone who needs to quote it. */}
      Reported by {who} {relativeAge(at)} · {exact}
    </p>
  );
}
