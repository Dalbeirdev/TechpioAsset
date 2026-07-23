import { cloneElement, forwardRef, isValidElement, type ReactElement } from 'react';
import { cn } from '@/lib/cn';

/** Minimal primitives shared across Phase 1 screens. */

const BUTTON_VARIANTS = {
  primary:
    'bg-[var(--color-brand)] text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]',
  secondary:
    'border border-[var(--color-border-strong)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-sunken)]',
  ghost: 'hover:bg-[var(--color-surface-sunken)]',
  danger: 'bg-[var(--tone-critical-solid)] text-white hover:opacity-90',
} as const;

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: keyof typeof BUTTON_VARIANTS;
    size?: 'sm' | 'md';
    loading?: boolean;
  }
>(function Button(
  { className, variant = 'primary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // Disabled while loading so a double-click cannot submit twice.
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
});

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)]',
          'bg-[var(--color-surface)] px-3 text-sm placeholder:text-[var(--color-content-subtle)]',
          'disabled:opacity-60',
          className,
        )}
        {...props}
      />
    );
  },
);

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
