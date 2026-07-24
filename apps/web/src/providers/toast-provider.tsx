'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, X, AlertCircle, Info } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Success/error/info notifications. Standard transient toasts — auto-dismiss,
 *  dismissible, announced to assistive tech. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, tone, message }]);
      // Errors linger a little longer so they can be read before dismissing.
      setTimeout(() => remove(id), tone === 'error' ? 6000 : 4000);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[min(92vw,360px)] flex-col gap-2"
      >
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const tone =
    toast.tone === 'success'
      ? {
          fg: 'var(--tone-success-fg)',
          bg: 'var(--tone-success-bg)',
          border: 'var(--tone-success-border)',
          Icon: CheckCircle2,
        }
      : toast.tone === 'error'
        ? {
            fg: 'var(--tone-critical-fg)',
            bg: 'var(--tone-critical-bg)',
            border: 'var(--tone-critical-border)',
            Icon: AlertCircle,
          }
        : {
            fg: 'var(--tone-info-fg)',
            bg: 'var(--tone-info-bg)',
            border: 'var(--tone-info-border)',
            Icon: Info,
          };
  const Icon = tone.Icon;
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="animate-[toastIn_180ms_ease-out] pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius-control)] border px-3.5 py-3 text-sm shadow-lg"
      style={{ color: tone.fg, backgroundColor: tone.bg, borderColor: tone.border }}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="flex-1 text-[var(--color-content)]">{toast.message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 text-[var(--color-content-subtle)] hover:text-[var(--color-content)]"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

/** Toast API. Safe no-op if used outside the provider so a stray call never crashes. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return ctx ?? { success: () => {}, error: () => {}, info: () => {} };
}
