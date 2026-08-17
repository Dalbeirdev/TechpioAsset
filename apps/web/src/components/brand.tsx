/**
 * PioAssets brand (2026-08): the wordmark artwork itself.
 *
 * The lockup is a raster because the artwork is a raster - hand-drawn lettering
 * with two gradients, not something a font plus a shape can stand in for. Both
 * the light and the dark rendering are shipped and swapped with the `dark`
 * variant rather than a filter, because the only thing that has to change on a
 * dark ground is the navy; the blue gradient and the orange stay as drawn.
 * Every file here is cut from one master by design/brand/build-brand-assets.py.
 *
 * BrandMark is the square "o + check" device, for the places that are square by
 * nature. It is vector because it is also the favicon, and a favicon has to be
 * crisp at 16px. Its colours are fixed: a logo does not re-tint per theme, and
 * the white tile is what keeps the navy ring legible on a dark surface.
 */

import { cn } from '@/lib/cn';

const WORDMARK_RATIO = 1836 / 337; // measured off the master artwork

export function BrandMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="64" height="64" rx="14" fill="#ffffff" />
      <circle cx="32" cy="32" r="19.3" stroke="#001858" strokeWidth="9.4" />
      <path
        d="M24.1 34.7 L31.8 39.9 L52 20.4"
        stroke="#f88808"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The wordmark. `height` is the rendered height in px; width follows the art.
 *
 * The tagline version of the artwork is not offered here - at the sizes a page
 * header gives a logo it is unreadable. It is used where there is room for it:
 * the email header and the social card.
 */
export function BrandLockup({
  height = 24,
  className = '',
}: {
  height?: number;
  className?: string;
}) {
  const width = Math.round(height * WORDMARK_RATIO);
  const common = { width, height, alt: 'PioAssets', decoding: 'async' as const };

  return (
    <span className={cn('inline-flex items-center', className)}>
      {/* Plain <img>, not next/image: fixed-size static art already cut to its
          display sizes, so the optimiser has nothing left to do. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...common}
        src={'/brand/pioassets-wordmark.png'}
        srcSet={'/brand/pioassets-wordmark.png 1x, /brand/pioassets-wordmark@2x.png 2x'}
        className="block dark:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...common}
        src={'/brand/pioassets-wordmark-dark.png'}
        srcSet={'/brand/pioassets-wordmark-dark.png 1x, /brand/pioassets-wordmark-dark@2x.png 2x'}
        className="hidden dark:block"
        aria-hidden="true"
        alt=""
      />
    </span>
  );
}
