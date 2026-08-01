/** Shared v2.4 procurement/inventory UI bits. */

export const PR_STATUS_TONE: Record<string, string> = {
  DRAFT: 'neutral',
  SUBMITTED: 'progress',
  APPROVED: 'success',
  REJECTED: 'critical',
  CONVERTED: 'info',
  CANCELLED: 'neutral',
};

export const PO_STATUS_TONE: Record<string, string> = {
  DRAFT: 'neutral',
  ISSUED: 'progress',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'neutral',
  CLOSED: 'neutral',
};

export function TonePill({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize"
      style={{ color: `var(--tone-${tone}-fg)`, background: `var(--tone-${tone}-bg)` }}
    >
      {label.toLowerCase().replace(/_/g, ' ')}
    </span>
  );
}

export const inputCls =
  'h-9 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm';

export const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
