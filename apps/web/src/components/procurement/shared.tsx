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

// Re-exported under its historical name so the six screens importing it from
// here do not all have to change; the definition lives in components/ui.
export { controlCls as inputCls } from '@/components/ui';

export const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
