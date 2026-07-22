import type { Tone, StatusToken } from '@techpioasset/ui-tokens';
import { cn } from '@/lib/cn';
import { resolveIcon } from './icon-registry';

interface StatusBadgeProps {
  token: StatusToken;
  size?: 'sm' | 'md';
  showIcon?: boolean;
  className?: string;
}

function toneVars(tone: Tone): React.CSSProperties {
  return {
    color: `var(--tone-${tone}-fg)`,
    backgroundColor: `var(--tone-${tone}-bg)`,
    borderColor: `var(--tone-${tone}-border)`,
  };
}

/**
 * Status pill. Colour comes from CSS custom properties emitted by the shared
 * token package, so a badge looks identical in both themes and matches mobile.
 *
 * The label is always rendered as text - colour alone never carries the meaning,
 * which is WCAG 1.4.1 and part of the section 26 AA target.
 */
export function StatusBadge({ token, size = 'md', showIcon = true, className }: StatusBadgeProps) {
  const Icon = showIcon ? resolveIcon(token.icon) : undefined;

  return (
    <span
      style={toneVars(token.tone)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className={size === 'sm' ? 'size-3' : 'size-3.5'} /> : null}
      {token.label}
    </span>
  );
}
