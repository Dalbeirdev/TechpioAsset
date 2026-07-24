'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { useFocusTrap } from '@/lib/use-focus-trap';

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive tone. */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Promise-based confirmation. `const ok = await confirm({...})` gates any
 * destructive action behind an explicit yes. One dialog instance, focus-trapped,
 * Escape-to-cancel.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(!!opts);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  }, []);

  // Focus the confirm button on open, and wire Escape to cancel.
  useEffect(() => {
    if (!opts) return;
    confirmBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opts, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts ? (
        <div
          className="fixed inset-0 z-[110] grid place-items-center bg-black/40 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          onClick={() => close(false)}
        >
          <Card className="w-full max-w-sm p-5">
            <div ref={trapRef} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start gap-3">
                {opts.destructive ? (
                  <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--tone-critical-bg)]">
                    <AlertTriangle
                      aria-hidden="true"
                      className="size-5 text-[var(--tone-critical-fg)]"
                    />
                  </div>
                ) : null}
                <div>
                  <h2 id="confirm-title" className="text-[15px] font-semibold">
                    {opts.title}
                  </h2>
                  {opts.body ? (
                    <p className="mt-1 text-sm text-[var(--color-content-muted)]">{opts.body}</p>
                  ) : null}
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => close(false)}>
                  {opts.cancelLabel ?? 'Cancel'}
                </Button>
                <Button
                  ref={confirmBtn}
                  size="sm"
                  variant={opts.destructive ? 'danger' : 'primary'}
                  onClick={() => close(true)}
                >
                  {opts.confirmLabel ?? 'Confirm'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

/** Returns `confirm(opts) => Promise<boolean>`. No-op resolves false if provider missing. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return ctx ?? (() => Promise.resolve(false));
}
