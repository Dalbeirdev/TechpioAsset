'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ASSET_STATUS_TOKENS, CONDITION_TOKENS } from '@techpioasset/ui-tokens';
import type { AssetCondition, AssetStatus } from '@techpioasset/domain';
import { apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';

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
}

export default function MyAssetsPage() {
  const { user } = useAuth();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['my-assets', user?.id],
    enabled: Boolean(user),
    queryFn: () => apiFetchPage<AssetRow>(`/assets?assignedUserId=${user!.id}&pageSize=100`),
  });

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">My assets</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Equipment currently issued to you.
        </p>
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
            title="Nothing assigned to you"
            description="When IT or the office team issues you equipment, it will appear here."
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
                    <dd>{[asset.brand, asset.model].filter(Boolean).join(' ')}</dd>
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
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
