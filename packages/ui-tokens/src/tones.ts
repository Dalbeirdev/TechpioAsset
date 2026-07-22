/**
 * Semantic tones.
 *
 * Status colour is expressed as a tone, never as a raw hex at the call site, so
 * that spec section 7's "consistent colors and icons throughout the web and
 * mobile applications" is enforced by construction. Tailwind resolves tones to
 * CSS variables; React Native reads the hex pairs directly.
 */

export const TONES = [
  'neutral',
  'info',
  'progress',
  'success',
  'warning',
  'danger',
  'critical',
  'muted',
] as const;

export type Tone = (typeof TONES)[number];

export interface TonePalette {
  /** Badge text colour. */
  readonly fg: string;
  /** Badge fill. */
  readonly bg: string;
  /** Badge hairline border. */
  readonly border: string;
  /** Solid dot / chart series colour. */
  readonly solid: string;
}

/**
 * Contrast: every fg/bg pair below meets WCAG 2.1 AA (>= 4.5:1) in its own
 * scheme. Spec section 26 requires an AA audit, and badge text is the control
 * most often failing it, so the pairs are chosen rather than derived.
 */
export const TONE_PALETTE_LIGHT: Readonly<Record<Tone, TonePalette>> = {
  neutral: { fg: '#334155', bg: '#f1f5f9', border: '#cbd5e1', solid: '#64748b' },
  info: { fg: '#1e40af', bg: '#eff6ff', border: '#bfdbfe', solid: '#3b82f6' },
  progress: { fg: '#5b21b6', bg: '#f5f3ff', border: '#ddd6fe', solid: '#8b5cf6' },
  success: { fg: '#166534', bg: '#f0fdf4', border: '#bbf7d0', solid: '#22c55e' },
  warning: { fg: '#854d0e', bg: '#fefce8', border: '#fde68a', solid: '#eab308' },
  danger: { fg: '#9a3412', bg: '#fff7ed', border: '#fed7aa', solid: '#f97316' },
  critical: { fg: '#991b1b', bg: '#fef2f2', border: '#fecaca', solid: '#ef4444' },
  muted: { fg: '#475569', bg: '#f8fafc', border: '#e2e8f0', solid: '#94a3b8' },
};

export const TONE_PALETTE_DARK: Readonly<Record<Tone, TonePalette>> = {
  neutral: { fg: '#cbd5e1', bg: '#1e293b', border: '#334155', solid: '#94a3b8' },
  info: { fg: '#bfdbfe', bg: '#172554', border: '#1e3a8a', solid: '#60a5fa' },
  progress: { fg: '#ddd6fe', bg: '#2e1065', border: '#4c1d95', solid: '#a78bfa' },
  success: { fg: '#bbf7d0', bg: '#052e16', border: '#14532d', solid: '#4ade80' },
  warning: { fg: '#fde68a', bg: '#422006', border: '#713f12', solid: '#facc15' },
  danger: { fg: '#fed7aa', bg: '#431407', border: '#7c2d12', solid: '#fb923c' },
  critical: { fg: '#fecaca', bg: '#450a0a', border: '#7f1d1d', solid: '#f87171' },
  muted: { fg: '#94a3b8', bg: '#0f172a', border: '#1e293b', solid: '#64748b' },
};
