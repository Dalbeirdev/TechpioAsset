'use client';

import { useEffect, useState } from 'react';
import { apiBaseUrl, getAccessToken } from '@/lib/api-client';

/**
 * The profile photo, fetched properly (v2.15).
 *
 * Avatars are private objects streamed from an authenticated endpoint - the
 * right design - but a bare <img src> carries no Authorization header, so
 * every avatar rendered that way was a silent 401 and a broken-image icon.
 * This fetches the bytes with the bearer token and renders an object URL,
 * falling back to the caller's children (initials) while loading or when
 * there is no photo.
 *
 * `version` busts the browser's HTTP cache after an upload. Pass something
 * that CHANGES with the photo - the avatar storage key from /me is ideal,
 * since every upload mints a new key: same key, same bytes; new key, new
 * URL, no five-minute stale window.
 */
export function AuthAvatar({
  className,
  alt = '',
  version = 0,
  enabled = true,
  children,
}: {
  className: string;
  alt?: string;
  version?: number | string;
  /** False when the profile has no photo - skips the request entirely. */
  enabled?: boolean;
  children?: React.ReactNode;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSrc(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${apiBaseUrl}/users/me/avatar?v=${encodeURIComponent(String(version))}`,
          {
            headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
          },
        );
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        // Network failure reads as "no photo"; the fallback stays up.
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, version]);

  if (!src) return <>{children ?? null}</>;
  // eslint-disable-next-line @next/next/no-img-element -- object URL from an authenticated fetch
  return <img src={src} alt={alt} className={className} />;
}
