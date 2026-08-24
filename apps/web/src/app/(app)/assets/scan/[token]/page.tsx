'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Card, ErrorState, Skeleton } from '@/components/ui';

/**
 * Where a printed QR label lands (v2.27).
 *
 * The label on an asset encodes this address, and until now nothing served it:
 * scanning a label with any phone camera opened a 404. The code was being
 * printed correctly and had nowhere to go.
 *
 * The token is resolved through the same `by-qr` endpoint the mobile scanner
 * uses, so a scanned label leaks nothing - it honours permission and scope, and
 * an employee scanning somebody else's device gets the same not-found as they
 * would anywhere else. On success this hands straight over to the asset page;
 * there is nothing to show here that the asset page does not show better.
 */
export default function AssetScanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();

  const asset = useQuery({
    queryKey: ['asset-by-qr', token],
    queryFn: () => apiFetch<{ id: string; assetTag: string }>(`/assets/by-qr/${token}`),
    retry: false,
  });

  useEffect(() => {
    if (asset.data) router.replace(`/assets/${asset.data.id}`);
  }, [asset.data, router]);

  if (asset.isError) {
    return (
      <div className="mx-auto grid max-w-lg gap-4">
        <ErrorState
          title="That label does not match an asset you can open"
          detail="It may belong to a device outside your access, or the label may be from another system. Check the asset tag printed beside the code."
        />
        <Card className="p-5">
          <p className="text-sm text-[var(--color-content-muted)]">
            You can look the device up by its tag instead.
          </p>
          <Link
            href="/assets"
            className="mt-3 inline-flex h-9 w-fit items-center rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
          >
            Search assets
          </Link>
        </Card>
      </div>
    );
  }

  // Resolving, then redirecting - both are brief, and a spinner that says
  // nothing is worse than a line that says what is happening.
  return (
    <div className="mx-auto grid max-w-lg gap-3">
      <p className="text-sm text-[var(--color-content-muted)]">Opening the scanned device…</p>
      <Skeleton className="h-48" />
    </div>
  );
}
