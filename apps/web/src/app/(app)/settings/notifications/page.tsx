'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Lock } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Card, Skeleton } from '@/components/ui';

/**
 * Notification preferences (spec section 19). The API (GET/PATCH
 * /notifications/preferences) has been live since v2.2 - this is the page the
 * profile menu pointed at without it existing, same story as security
 * settings before v2.11.
 *
 * Mandatory types (approvals, security) come back `locked` and render as
 * disabled controls rather than being hidden: users should see what they are
 * always told, and why, instead of wondering where a setting went.
 */

type ChannelPref = {
  channel: 'IN_APP' | 'EMAIL' | 'PUSH' | 'TEAMS' | 'SLACK';
  enabled: boolean;
  locked: boolean;
};

type Preference = {
  type: string;
  title: string;
  mandatory: boolean;
  channels: ChannelPref[];
};

const CHANNEL_LABELS: Record<string, string> = {
  IN_APP: 'In app',
  EMAIL: 'Email',
  PUSH: 'Push',
  TEAMS: 'Teams',
  SLACK: 'Slack',
};

/** Column order; only columns some type actually offers are rendered. */
const CHANNEL_ORDER: ChannelPref['channel'][] = ['IN_APP', 'EMAIL', 'PUSH', 'TEAMS', 'SLACK'];

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => apiFetch<Preference[]>('/notifications/preferences'),
  });

  const toggle = useMutation({
    mutationFn: (input: { type: string; channel: string; enabled: boolean }) =>
      apiFetch('/notifications/preferences', { method: 'PATCH', body: input }),
    // Optimistic: a preference toggle that takes a round-trip to move feels
    // broken. Roll back if the server refuses.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['notification-preferences'] });
      const previous = qc.getQueryData<Preference[]>(['notification-preferences']);
      qc.setQueryData<Preference[]>(['notification-preferences'], (old) =>
        (old ?? []).map((p) =>
          p.type === input.type
            ? {
                ...p,
                channels: p.channels.map((c) =>
                  c.channel === input.channel ? { ...c, enabled: input.enabled } : c,
                ),
              }
            : p,
        ),
      );
      return { previous };
    },
    onError: (e, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(['notification-preferences'], ctx.previous);
      toast.error(e instanceof Error ? e.message : 'Could not save that preference');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notification-preferences'] }),
  });

  if (!user || isLoading) return <Skeleton className="mx-auto h-96 max-w-3xl" />;

  const columns = CHANNEL_ORDER.filter((ch) =>
    (prefs ?? []).some((p) => p.channels.some((c) => c.channel === ch)),
  );

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Bell aria-hidden="true" className="size-5 text-[var(--color-brand)]" /> Notifications
        </h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          Choose how you hear about each kind of event. Items with a lock are security and
          workflow notifications that cannot be turned off.
        </p>
      </header>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-content-subtle)]">
              <th className="px-4 py-3 font-medium">Notification</th>
              {columns.map((ch) => (
                <th key={ch} className="px-3 py-3 text-center font-medium">
                  {CHANNEL_LABELS[ch] ?? ch}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(prefs ?? []).map((pref) => (
              <tr key={pref.type} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-1.5 font-medium">
                    {pref.title}
                    {pref.mandatory ? (
                      <Lock
                        aria-label="Always on"
                        className="size-3.5 text-[var(--color-content-subtle)]"
                      />
                    ) : null}
                  </span>
                </td>
                {columns.map((ch) => {
                  const cell = pref.channels.find((c) => c.channel === ch);
                  if (!cell) return <td key={ch} className="px-3 py-2.5 text-center">—</td>;
                  return (
                    <td key={ch} className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${pref.title} via ${CHANNEL_LABELS[ch] ?? ch}`}
                        checked={cell.enabled}
                        disabled={cell.locked}
                        onChange={(e) =>
                          toggle.mutate({
                            type: pref.type,
                            channel: ch,
                            enabled: e.target.checked,
                          })
                        }
                        className="size-4 accent-[var(--color-brand)] disabled:opacity-40"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
