import { useColorScheme } from 'react-native';
import {
  ASSET_STATUS_TOKENS,
  TONE_PALETTE_LIGHT,
  TONE_PALETTE_DARK,
} from '@techpioasset/ui-tokens';
import type { AssetStatus } from '@techpioasset/domain';

/**
 * Mobile theme. Reuses the shared token package so status colours match the web
 * app exactly (spec section 7), and adds a full set of surface/semantic colours,
 * a spacing + radius scale, and elevation presets so every screen shares one
 * professional visual language.
 */
export const colors = {
  light: {
    background: '#f1f5f9',
    surface: '#ffffff',
    card: '#ffffff',
    border: '#e2e8f0',
    text: '#0f172a',
    muted: '#64748b',
    subtle: '#94a3b8',
    brand: '#2563eb',
    brandText: '#ffffff',
    brandSoft: '#eff6ff',
    danger: '#dc2626',
    dangerSoft: '#fef2f2',
    success: '#16a34a',
    warning: '#d97706',
    headerBg: '#ffffff',
    tabBar: '#ffffff',
    tabActive: '#2563eb',
    tabInactive: '#94a3b8',
  },
  dark: {
    background: '#0b1120',
    surface: '#111a2e',
    card: '#111a2e',
    border: '#1e293b',
    text: '#e2e8f0',
    muted: '#94a3b8',
    subtle: '#64748b',
    brand: '#3b82f6',
    brandText: '#ffffff',
    brandSoft: '#172554',
    danger: '#f87171',
    dangerSoft: '#3f1d1d',
    success: '#4ade80',
    warning: '#fbbf24',
    headerBg: '#0f172a',
    tabBar: '#0f172a',
    tabActive: '#60a5fa',
    tabInactive: '#64748b',
  },
};

export type ThemeColors = (typeof colors)['light'];
export type Scheme = 'light' | 'dark';

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

/** Card elevation — soft shadow on light, a hairline border carries depth on dark. */
export function elevation(scheme: Scheme, level: 1 | 2 = 1) {
  if (scheme === 'dark') return {};
  const base = level === 2 ? { opacity: 0.1, r: 16, y: 6 } : { opacity: 0.06, r: 8, y: 2 };
  return {
    shadowColor: '#0f172a',
    shadowOpacity: base.opacity,
    shadowRadius: base.r,
    shadowOffset: { width: 0, height: base.y },
    elevation: level * 2,
  };
}

export interface Theme {
  scheme: Scheme;
  c: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  elevation: (level?: 1 | 2) => ReturnType<typeof elevation>;
}

export function useTheme(): Theme {
  const scheme = (useColorScheme() ?? 'light') as Scheme;
  return {
    scheme,
    c: colors[scheme],
    spacing,
    radius,
    elevation: (level: 1 | 2 = 1) => elevation(scheme, level),
  };
}

export function statusColor(status: AssetStatus, scheme: Scheme) {
  const tone = ASSET_STATUS_TOKENS[status].tone;
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  return palette[tone];
}

export function statusLabel(status: AssetStatus): string {
  return ASSET_STATUS_TOKENS[status].label;
}
