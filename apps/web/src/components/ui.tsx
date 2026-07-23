import { cloneElement, forwardRef, isValidElement, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button as ShadButton, type ButtonProps as ShadButtonProps } from '@/components/ui/button';
import { Input as ShadInput } from '@/components/ui/input';

/**
 * Shared primitives. Button and Input are now backed by shadcn/ui; this module
 * keeps the app's historical ergonomics (variant names, a `loading` prop, and a
 * two-size scale) so existing callers do not change, while the underlying
 * components are the shadcn ones.
 */

// The app's variant vocabulary mapped onto shadcn's.
const VARIANT_MAP = {
  primary: 'default',
  secondary: 'secondary',
  ghost: 'ghost',
  danger: 'destructive',
} as const;

export const Button = forwardRef<
  HTMLButtonElement,
  Omit<ShadButtonProps, 'variant' | 'size'> & {
    variant?: keyof typeof VARIANT_MAP;
    size?: 'sm' | 'md';
    loading?: boolean;
  }
>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <ShadButton
      ref={ref}
      variant={VARIANT_MAP[variant]}
      size={size === 'sm' ? 'sm' : 'default'}
      // Disabled while loading so a double-click cannot submit twice.
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
      {children}
    </ShadButton>
  );
});

export const Input = ShadInput;

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  // aria-describedby and aria-invalid must sit on the control itself, not a
  // wrapper, or a screen reader will not announce the hint/error when the field
  // is focused. Inject them here so no caller has to remember (WCAG 3.3.1).
  const control =
    isValidElement(children) && describedBy
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          'aria-describedby': describedBy,
          ...(error ? { 'aria-invalid': true } : {}),
        })
      : children;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {control}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-[var(--color-content-subtle)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-[var(--tone-critical-fg)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'critical' | 'info';
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-[var(--color-content-subtle)]">{label}</p>
      <p
        className="mt-1.5 text-2xl font-semibold tabular-nums"
        style={tone === 'neutral' ? undefined : { color: `var(--tone-${tone}-fg)` }}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-content-subtle)]">{hint}</p> : null}
    </Card>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded bg-[var(--color-surface-sunken)]', className)}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-16 text-center">
      <p className="font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--color-content-muted)]">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role="alert" className="grid place-items-center gap-2 px-6 py-16 text-center">
      <p className="font-medium text-[var(--tone-critical-fg)]">{title}</p>
      {detail ? (
        <p className="max-w-md text-sm text-[var(--color-content-muted)]">{detail}</p>
      ) : null}
    </div>
  );
}
