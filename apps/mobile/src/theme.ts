import {
  ASSET_STATUS_TOKENS,
  TONE_PALETTE_LIGHT,
  TONE_PALETTE_DARK,
} from '@techpioasset/ui-tokens';
import type { AssetStatus } from '@techpioasset/domain';

/**
 * Mobile theme, reusing the shared token package so status colours match the web
 * app exactly (spec section 7: consistent colours across web and mobile).
 */
export const colors = {
  light: {
    background: '#ffffff',
    surface: '#f8fafc',
    border: '#e2e8f0',
    text: '#0f172a',
    muted: '#64748b',
    brand: '#1d4ed8',
    brandText: '#ffffff',
  },
  dark: {
    background: '#0b1120',
    surface: '#0f172a',
    border: '#1e293b',
    text: '#e2e8f0',
    muted: '#94a3b8',
    brand: '#60a5fa',
    brandText: '#0b1120',
  },
};

export function statusColor(status: AssetStatus, scheme: 'light' | 'dark') {
  const tone = ASSET_STATUS_TOKENS[status].tone;
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  return palette[tone];
}

export function statusLabel(status: AssetStatus): string {
  return ASSET_STATUS_TOKENS[status].label;
}
