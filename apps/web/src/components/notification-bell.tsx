'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { apiFetch, apiFetchPage } from '@/lib/api-client';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  linkPath: string | null;
  readAt: string | null;
  simulated: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiFetch<{ count: number }>('/notifications/unread-count'),
    // Polled rather than pushed: websockets are not part of this phase, and a
    // 60s refresh is enough for approval turnaround.
    refetchInterval: 60_000,
  });

  const { data: list } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => apiFetchPage<NotificationRow>('/notifications?pageSize=8'),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const count = unread?.count ?? 0;

  async function markAllRead() {
    await apiFetch('/notifications/read-all', { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-9 place-items-center rounded-[var(--radius-control)] hover:bg-[var(--color-surface-sunken)]"
      >
        <Bell aria-hidden="true" className="size-5" />
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums"
            style={{ backgroundColor: 'var(--tone-critical-solid)', color: '#fff' }}
          >
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {count > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="inline-flex items-center gap-1 text-xs text-[var(--color-content-muted)] hover:underline"
              >
                <CheckCheck aria-hidden="true" className="size-3.5" />
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {!list ? (
              <p className="px-4 py-6 text-center text-sm text-[var(--color-content-subtle)]">
                Loading…
              </p>
            ) : list.data.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-[var(--color-content-subtle)]">
                Nothing yet.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {list.data.map((item) => {
                  const content = (
                    <div className={item.readAt ? 'opacity-60' : undefined}>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
                        {item.body}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--color-content-subtle)]">
                        {new Date(item.createdAt).toLocaleString()}
                        {/* Spec section 28: a simulated delivery is never shown as a real one. */}
                        {item.simulated ? ' · email simulated' : ''}
                      </p>
                    </div>
                  );

                  return (
                    <li key={item.id} className="px-4 py-3 hover:bg-[var(--color-surface-sunken)]">
                      {item.linkPath ? (
                        <Link href={item.linkPath} onClick={() => setOpen(false)}>
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
