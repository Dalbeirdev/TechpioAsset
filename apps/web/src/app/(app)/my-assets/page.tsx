'use client';

import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ASSET_STATUS_TOKENS, CONDITION_TOKENS } from '@techpioasset/ui-tokens';
import type { AssetCondition, AssetStatus } from '@techpioasset/domain';
import { apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { AcknowledgeButton } from '@/components/assets/custody-panel';

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  assignmentDate: string | null;
  warrantyEndDate: string | null;
  category: { name: string } | null;
  /** The open assignment, if any - at most one row. */
  assignments: { id: string; acknowledgedAt: string | null; expectedReturnAt: string | null }[];
}

export default function MyAssetsPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <MyAssetsList />
    </Suspense>
  );
}

function MyAssetsList() {
  const { user } = useAuth();
  // The header search sends OWN-scope users here with ?q=. The API already
  // matches name/tag/serial/brand/model and is scoped to the caller, so the
  // term simply rides along - no client-side filtering to drift out of step.
  const params = useSearchParams();
  const q = params.get('q')?.trim() ?? '';

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['my-assets', user?.id, q],
    enabled: Boolean(user),
    queryFn: () =>
      apiFetchPage<AssetRow>(
        `/assets?assignedUserId=${user!.id}&pageSize=100${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
  });

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">My assets</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {q ? `Your equipment matching “${q}”.` : 'Equipment currently issued to you.'}
        </p>
        {q ? (
          <Link href="/my-assets" className="mt-1 inline-block text-sm text-[var(--color-brand)]">
            Clear search
          </Link>
        ) : null}
      </header>

      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState title="Could not load your assets" detail={(error as Error).message} />
      ) : data.data.length === 0 ? (
        <Card>
          <EmptyState
            title={q ? 'No equipment matches that search' : 'Nothing assigned to you'}
            description={
              q
                ? 'Try a different asset name, tag or serial number.'
                : 'When IT or the office team issues you equipment, it will appear here.'
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.data.map((asset) => (
            <Card key={asset.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/assets/${asset.id}`} className="font-medium hover:underline">
                    {asset.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">
                    {asset.assetTag}
                  </p>
                </div>
                <StatusBadge token={ASSET_STATUS_TOKENS[asset.status]} size="sm" />
              </div>

              <dl className="mt-3 grid gap-1 text-xs text-[var(--color-content-muted)]">
                {asset.brand || asset.model ? (
                  <div className="flex gap-1">
                    <dt className="sr-only">Model</dt>
                    <dd>
                      {[...new Set([asset.brand, asset.model].filter(Boolean))].join(' ')}
                    </dd>
                  </div>
                ) : null}
                {asset.serialNumber ? (
                  <div className="flex gap-1">
                    <dt>Serial:</dt>
                    <dd className="font-mono">{asset.serialNumber}</dd>
                  </div>
                ) : null}
                {asset.assignmentDate ? (
                  <div className="flex gap-1">
                    <dt>Issued:</dt>
                    <dd>{new Date(asset.assignmentDate).toLocaleDateString()}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="mt-3">
                <StatusBadge token={CONDITION_TOKENS[asset.condition]} size="sm" />
              </div>

              {/* Confirming receipt closes the loop on a handover: until the
                  holder does it, IT only knows the device left the shelf. */}
              {asset.assignments[0] && !asset.assignments[0].acknowledgedAt ? (
                <div
                  className="mt-3 rounded-[var(--radius-control)] border px-3 py-2.5"
                  style={{
                    color: 'var(--tone-warning-fg)',
                    backgroundColor: 'var(--tone-warning-bg)',
                    borderColor: 'var(--tone-warning-border)',
                  }}
                >
                  <p className="text-xs font-medium">Please confirm you received this.</p>
                  <div className="mt-2">
                    <AcknowledgeButton assignmentId={asset.assignments[0].id} />
                  </div>
                </div>
              ) : null}

              {/* Self-service intents, pre-filled with this device so nobody
                  types an asset tag by hand. */}
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--color-border)] pt-3">
                <Link
                  href={`/requests/new?report=issue&about=${encodeURIComponent(`${asset.assetTag} ${asset.name}`)}`}
                  className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
                >
                  Report issue
                </Link>
                <Link
                  href={`/requests/new?type=REPLACEMENT&about=${encodeURIComponent(`${asset.assetTag} ${asset.name}`)}`}
                  className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
                >
                  Replacement
                </Link>
                <Link
                  href={`/requests/new?type=UPGRADE&about=${encodeURIComponent(`${asset.assetTag} ${asset.name}`)}`}
                  className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
                >
                  Upgrade
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
