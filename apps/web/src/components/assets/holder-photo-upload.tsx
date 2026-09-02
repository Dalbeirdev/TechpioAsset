'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { apiFetch, API_BASE, getAccessToken } from '@/lib/api-client';
import { Button } from '@/components/ui';

/**
 * The holder's own photos, taken before they confirm receipt (v2.35).
 *
 * Deliberately sited beside the Confirm button rather than on the asset page,
 * because the two are one action: this is what I was given, and I am confirming
 * I received it. Split across two screens, the photo half simply would not
 * happen - nobody navigates somewhere else before pressing a button that is
 * already in front of them.
 *
 * It is a one-time window and the person closing it is the person it protects,
 * so the wording has to be plain about that. "Confirming locks these" is the
 * whole contract, and burying it would make the lock feel like a bug later.
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

  // Nothing to offer once the window has closed, or before there is a handover
  // record to attach to.
  if (!current || !current.open || current.acknowledgedAt) return null;

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

      <p className="mt-1.5 text-xs">
        {mine > 0
          ? `${mine} photo${mine === 1 ? '' : 's'} added. Confirming below locks them — after that only IT can change them.`
          : 'Optional. Photograph any marks or damage now; confirming below locks what you add.'}
      </p>

      {error ? <p className="mt-1 text-xs font-medium">{error}</p> : null}
    </div>
  );
}
