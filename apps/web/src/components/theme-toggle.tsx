'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const;

/**
 * `labels` spells the options out instead of relying on the icon alone. Used
 * where there is room for it and the visitor is not yet fluent in the product -
 * the sign-in page - and left off inside the app, where the header is tight.
 */
export function ThemeToggle({ labels = false }: { labels?: boolean } = {}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server cannot know the resolved theme, so rendering the active state
  // before mount would hydrate mismatched markup.
  useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={cn(
              'inline-flex h-8 items-center justify-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] transition-colors',
              labels ? 'px-2.5 text-sm font-medium' : 'w-8',
              active
                ? 'bg-[var(--color-brand)] text-[var(--color-brand-contrast)]'
                : 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {labels ? <span aria-hidden="true">{label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
