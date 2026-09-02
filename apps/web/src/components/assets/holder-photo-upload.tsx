'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { apiFetch, API_BASE, getAccessToken } from '@/lib/api-client';
import { Button } from '@/components/ui';

/**
 * The holder's own photos, taken before they confirm receipt (v2.35).
 *
 * Offered on every asset a person holds, not only the one awaiting
 * confirmation. A mouse or a monitor gets damaged months after it was issued,
 * and the holder is the only one looking at it - restricting photographs to the
 * first day would have collected them for exactly the assets least likely to
 * need them.
 *
 * Confirming receipt still locks REMOVAL. Before it, the wording says so
 * plainly, because that is the half of the contract someone can be surprised
 * by later.
 */

interface Photo {
  id: string;
  byHolder: boolean;
}

interface CustodyGroup {
  open: boolean;
  acknowledgedAt: string | null;
  handover: Photo[];
}

export function HolderPhotoUpload({ assetId }: { assetId: string }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery<CustodyGroup[]>({
    queryKey: ['asset-photos', assetId],
    queryFn: () => apiFetch(`/assets/${assetId}/photos`),
  });

  const current = data?.[0];
  const mine = current?.handover.filter((p) => p.byHolder).length ?? 0;

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      body.append('stage', 'HANDOVER');
      const res = await fetch(`${API_BASE}/assets/${assetId}/photos`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        body,
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => null);
        throw new Error(problem?.detail ?? problem?.title ?? 'Could not add that photo');
      }
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['asset-photos', assetId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // Only needs a handover record to attach to. An imported asset with no
  // assignment has nowhere to file a photo, and the asset page explains that
  // rather than this button failing silently.
  if (!current || !current.open) return null;

  const locked = Boolean(current.acknowledgedAt);

  return (
    <div className="mt-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        // Opens the rear camera directly on a phone, which is where somebody
        // standing at a desk with a new laptop actually is.
        capture="environment"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          for (const file of files) upload.mutate(file);
        }}
      />

      <Button
        variant="secondary"
        onClick={() => fileRef.current?.click()}
        loading={upload.isPending}
      >
        <Camera aria-hidden="true" className="size-4" />
        {mine > 0 ? 'Add another photo' : 'Add a photo of it'}
      </Button>

      <p className="mt-1.5 text-xs text-[var(--color-content-muted)]">
        {locked
          ? mine > 0
            ? `${mine} of your photo${mine === 1 ? '' : 's'} on record. You can add more; removing them needs IT.`
            : 'Photograph any marks or damage. Once added, removing it needs IT.'
          : mine > 0
            ? `${mine} photo${mine === 1 ? '' : 's'} added. Confirming receipt locks them — after that only IT can take them down.`
            : 'Optional. Photograph any marks or damage now; confirming receipt locks what you add.'}
      </p>

      {error ? <p className="mt-1 text-xs font-medium">{error}</p> : null}
    </div>
  );
}
