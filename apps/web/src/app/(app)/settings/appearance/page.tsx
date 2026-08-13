'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import { Card } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Appearance settings. The profile menu linked here without the page
 * existing. Everything on this page is a device preference stored in the
 * browser (next-themes → localStorage), which the page says out loud so
 * nobody wonders why their phone looks different from their laptop.
 */

const THEMES = [
  {
    value: 'light',
    label: 'Light',
    description: 'Bright surfaces, dark text.',
    Icon: Sun,
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Dark surfaces, easy on the eyes at night.',
    Icon: Moon,
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow this device’s setting, switching automatically.',
    Icon: Monitor,
  },
] as const;

export default function AppearanceSettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server cannot know the stored theme; rendering the active state
  // before mount would hydrate mismatched markup.
  useEffect(() => setMounted(true), []);

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Palette aria-hidden="true" className="size-5 text-[var(--color-brand)]" /> Appearance
        </h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          How PioAssets looks on this device. Saved in this browser, not on your account.
        </p>
      </header>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">Colour theme</h2>
        <div role="radiogroup" aria-label="Colour theme" className="grid gap-2 sm:grid-cols-3">
          {THEMES.map(({ value, label, description, Icon }) => {
            const active = mounted && theme === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(value)}
                className={cn(
                  'grid gap-1.5 rounded-[var(--radius-card)] border p-4 text-left transition-colors',
                  active
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/5'
                    : 'border-[var(--color-border-strong)] hover:bg-[var(--color-surface-sunken)]',
                )}
              >
                <span
                  className={cn(
                    'grid size-8 place-items-center rounded-lg',
                    active
                      ? 'bg-[var(--color-brand)] text-[var(--color-brand-contrast)]'
                      : 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]',
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-[var(--color-content-subtle)]">{description}</span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
