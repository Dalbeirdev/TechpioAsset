'use client';

import { useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

/**
 * A condition photo at full size (v2.36).
 *
 * The thumbnails are 96px, which is enough to see that a photo exists and not
 * enough to see the scratch it was taken for. This is the screen where the
 * question actually gets answered, so it carries the caption, who took it and
 * when - a photograph on its own proves nothing without those.
 *
 * Arrow keys and the buttons step through the set rather than making somebody
 * close and reopen for each one: comparing a handover shot against the return
 * shot means going back and forth, repeatedly.
 */

export interface LightboxPhoto {
  id: string;
  url: string;
  caption: string | null;
  takenAt: string;
  by: string | null;
  /** "At handover" / "On return" - which end of the custody event this was. */
  stageLabel: string;
}

export function PhotoLightbox({
  photos,
  index,
  onClose,
  onIndexChange,
}: {
  photos: LightboxPhoto[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
}) {
  const photo = photos[index];
  const many = photos.length > 1;

  const step = useCallback(
    (delta: number) => {
      if (!many) return;
      onIndexChange((index + delta + photos.length) % photos.length);
    },
    [index, many, onIndexChange, photos.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll while this is over it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, step]);

  if (!photo) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.caption ?? 'Condition photo'}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm"
      // Clicking the backdrop closes; clicking the image itself must not.
      onClick={onClose}
    >
      <div className="flex items-start justify-between gap-4 p-4 text-white">
        <div className="min-w-0">
          <p className="text-sm font-medium">{photo.caption ?? photo.stageLabel}</p>
          <p className="mt-0.5 text-xs text-white/70">
            {photo.stageLabel}
            {' · '}
            {new Date(photo.takenAt).toLocaleString()}
            {photo.by ? ` · ${photo.by}` : ''}
            {many ? ` · ${index + 1} of ${photos.length}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 px-4 pb-6">
        {many ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            aria-label="Previous photo"
            className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
          >
            <ChevronLeft aria-hidden="true" className="size-6" />
          </button>
        ) : null}

        {/* eslint-disable-next-line @next/next/no-img-element --
            a blob: URL from an authenticated fetch; next/image cannot fetch it
            server-side, and these must not be cached anywhere shared. */}
        <img
          src={photo.url}
          alt={photo.caption ?? `${photo.stageLabel} photo`}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full rounded object-contain"
        />

        {many ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            aria-label="Next photo"
            className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
          >
            <ChevronRight aria-hidden="true" className="size-6" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
