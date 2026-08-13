/**
 * PioAssets brand (2026-08): the Stack mark — three inventory layers, top one
 * checked off. Colours ride the theme tokens, so the mark adapts to light and
 * dark for free; the favicon (app/icon.svg) is the same geometry with fixed
 * colours because a standalone file cannot read CSS variables.
 */

export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="7" y="30" width="34" height="9" rx="3.5" fill="var(--color-brand)" fillOpacity="0.35" />
      <rect x="7" y="19" width="34" height="9" rx="3.5" fill="var(--color-brand)" fillOpacity="0.65" />
      <rect x="7" y="8" width="34" height="9" rx="3.5" fill="var(--color-brand)" />
      <path
        d="M18 12.5 l2.8 2.8 5.6 -5.6"
        stroke="var(--color-surface-raised)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandLockup({ markSize = 24, textClass = '' }: { markSize?: number; textClass?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark size={markSize} />
      <span className={`font-semibold tracking-tight ${textClass}`.trim()}>
        Pio<span className="text-[var(--color-brand)]">Assets</span>
      </span>
    </span>
  );
}
