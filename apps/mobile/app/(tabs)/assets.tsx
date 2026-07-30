import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import type { AssetStatus, AssetCondition } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme, statusColor, statusLabel } from '../../src/theme';
import { Card, Chevron, EmptyState, Field, IconBadge, StatusPill } from '../../src/components/ui';

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  condition: AssetCondition;
  serialNumber: string | null;
  category: { name: string } | null;
  assignedUser: { profile: { displayName: string | null } | null } | null;
}

/** All company assets — searchable list, tap to open the asset. */
export default function AssetsScreen() {
  const { api } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();

  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.request<AssetRow[]>('/assets?pageSize=200');
      setRows(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(t) ||
        r.assetTag.toLowerCase().includes(t) ||
        (r.serialNumber ?? '').toLowerCase().includes(t),
    );
  }, [rows, q]);

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.background }}
      data={filtered}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ marginBottom: spacing.md }}>
          <Field placeholder="Search assets by name, tag, or serial" value={q} onChangeText={setQ} />
        </View>
      }
      ListEmptyComponent={
        loading ? null : (
          <EmptyState
            icon="cube-outline"
            title={q ? 'No matches' : 'No assets yet'}
            message={q ? 'Try a different search.' : 'Assets added on the web appear here.'}
          />
        )
      }
      renderItem={({ item }) => {
        const tone = statusColor(item.status, scheme);
        const holder = item.assignedUser?.profile?.displayName;
        return (
          <Card
            onPress={() => router.push(`/asset/${item.id}`)}
            style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <IconBadge icon="hardware-chip-outline" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {item.assetTag}
                {item.category ? ` · ${item.category.name}` : ''}
                {holder ? ` · ${holder}` : ''}
              </Text>
              <View style={{ marginTop: 8 }}>
                <StatusPill label={statusLabel(item.status)} bg={tone.bg} fg={tone.fg} />
              </View>
            </View>
            <Chevron />
          </Card>
        );
      }}
    />
  );
}
