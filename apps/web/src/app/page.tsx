import {
  ASSET_STATUS_TOKENS,
  REQUEST_STATUS_TOKENS,
  VERIFICATION_STATUS_TOKENS,
  CONDITION_TOKENS,
  type StatusToken,
} from '@techpioasset/ui-tokens';
import {
  ASSET_STATUSES,
  REQUEST_STATUSES,
  VERIFICATION_STATUSES,
  ASSET_CONDITIONS,
} from '@techpioasset/domain';
import { StatusBadge } from '@/components/status-badge';
import { ThemeToggle } from '@/components/theme-toggle';

export const metadata = { title: 'Foundation' };

function TokenSection({
  title,
  caption,
  values,
  tokens,
}: {
  title: string;
  caption: string;
  values: readonly string[];
  tokens: Record<string, StatusToken>;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-xs text-[var(--color-content-subtle)]">{caption}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {values.map((value) => {
          const token = tokens[value];
          return token ? <StatusBadge key={value} token={token} size="sm" /> : null;
        })}
      </div>
    </section>
  );
}

/**
 * Phase 0 foundation page.
 *
 * Not a dashboard - Phase 1 owns those. This renders every status token so the
 * shared palette can be checked in both themes, and reports what the phase
 * actually delivered.
 */
export default function FoundationPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-border)] pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">TechpioAsset</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Manage Assets. Control Costs. Simplify Operations.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-content-subtle)]">
            Phase 0 · Foundation
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="mt-8 grid gap-4">
        <TokenSection
          title="Asset statuses"
          caption="Spec section 7 — 18 statuses, consistent colours and icons across web and mobile."
          values={ASSET_STATUSES}
          tokens={ASSET_STATUS_TOKENS}
        />
        <TokenSection
          title="Request statuses"
          caption="Spec section 11 — 16 statuses driving the configurable approval workflow."
          values={REQUEST_STATUSES}
          tokens={REQUEST_STATUS_TOKENS}
        />
        <TokenSection
          title="Invoice verification statuses"
          caption="Spec section 9 — 16 statuses. Verified and Rejected require a human reviewer."
          values={VERIFICATION_STATUSES}
          tokens={VERIFICATION_STATUS_TOKENS}
        />
        <TokenSection
          title="Conditions"
          caption="Spec section 6 — recorded on assignment, return and inspection."
          values={ASSET_CONDITIONS}
          tokens={CONDITION_TOKENS}
        />
      </div>

      <footer className="mt-10 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-5 text-sm">
        <h2 className="font-semibold">What Phase 0 delivered</h2>
        <ul className="mt-3 grid gap-1.5 text-[var(--color-content-muted)]">
          <li>Monorepo, shared domain / contracts / token packages, 128 unit tests.</li>
          <li>Prisma schema: 54 tables, 27 enums, 107 indexes, 126 foreign keys.</li>
          <li>NestJS API shell: response envelope, problem+json errors, health probes.</li>
          <li>Idempotent seed for permissions, the eight system roles and the category tree.</li>
        </ul>
        <p className="mt-4 text-xs text-[var(--color-content-subtle)]">
          Authentication, dashboards and asset management arrive in Phase 1.
        </p>
      </footer>
    </main>
  );
}
