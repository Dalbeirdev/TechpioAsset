import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Card, EmptyState, IconBadge, StatusPill } from '../src/components/ui';

/**
 * v2.5 H6 - the technician's work-order list. "Mine" is the default (the jobs
 * on my plate, SLA-overdue first); "All open" shows the rest of the queue.
 */

export interface WorkOrderRow {
  id: string;
  type: string;
  status: string;
  title: string;
  scheduledFor: string | null;
  technicianId: string | null;
  slaDueAt: string | null;
  escalatedAt: string | null;
  asset: { id: string; assetTag: string; name: string } | null;
}

export const WO_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'critical' | 'muted'> = {
  REQUESTED: 'neutral',
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',
  ON_HOLD: 'neutral',
  COMPLETED: 'success',
  CANCELLED: 'muted',
  FAILED: 'critical',
};

export function woLabel(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase();
}

export function isSlaOverdue(row: { slaDueAt: string | null; status: string }): boolean {
  return (
    row.slaDueAt != null &&
    new Date(row.slaDueAt).getTime() < Date.now() &&
    !['COMPLETED', 'CANCELLED', 'FAILED'].includes(row.status)
  );
}

const OPEN = ['REQUESTED', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD'];

export default function WorkOrdersScreen() {
  const { api, user } = useSession();
  const { c, scheme, spacing } = useTheme();
  const router = useRouter();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = scope === 'mine' ? `&technicianId=${user?.id ?? ''}` : '';
      const all = (await api.request<WorkOrderRow[]>(`/maintenance?pageSize=100${query}`)) ?? [];
      const open = all.filter((r) => OPEN.includes(r.status));
      // Overdue SLAs first, then soonest deadline, then newest.
      open.sort((a, b) => {
        const overdue = Number(isSlaOverdue(b)) - Number(isSlaOverdue(a));
        if (overdue !== 0) return overdue;
        const dueA = a.slaDueAt ? new Date(a.slaDueAt).getTime() : Infinity;
        const dueB = b.slaDueAt ? new Date(b.slaDueAt).getTime() : Infinity;
        return dueA - dueB;
      });
      setRows(open);
    } finally {
      setLoading(false);
    }
  }, [api, scope, user?.id]);
  useEffect(() => void load(), [load]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: 0 }}>
        {(
          [
            ['mine', 'Mine'],
            ['all', 'All open'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setScope(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: scope === key }}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 99,
              backgroundColor: scope === key ? c.brand : c.surface,
              borderWidth: 1,
              borderColor: scope === key ? c.brand : c.border,
            }}
          >
            <Text
              style={{
                color: scope === key ? c.brandText : c.muted,
                fontWeight: '600',
                fontSize: 13,
              }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="build-outline"
              title={scope === 'mine' ? 'Nothing on your plate' : 'No open work orders'}
              message={
                scope === 'mine'
                  ? 'Work orders assigned to you appear here, overdue first.'
                  : 'Open repairs and services appear here.'
              }
            />
          )
        }
        renderItem={({ item }) => {
          const tone = palette[WO_TONE[item.status] ?? 'neutral'];
          const overdue = isSlaOverdue(item);
          return (
            <Card
              onPress={() => router.push(`/work-order/${item.id}`)}
              style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
            >
              <IconBadge icon="build-outline" tint={overdue ? c.danger : undefined} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {item.asset ? `${item.asset.assetTag} · ` : ''}
                  {item.type.toLowerCase()}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  <StatusPill label={woLabel(item.status)} bg={tone.bg} fg={tone.fg} />
                  {item.slaDueAt ? (
                    <StatusPill
                      label={
                        overdue
                          ? `SLA overdue${item.escalatedAt ? ' · escalated' : ''}`
                          : `due ${new Date(item.slaDueAt).toLocaleDateString()}`
                      }
                      bg={overdue ? palette.critical.bg : palette.info.bg}
                      fg={overdue ? palette.critical.fg : palette.info.fg}
                    />
                  ) : null}
                </View>
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
}
