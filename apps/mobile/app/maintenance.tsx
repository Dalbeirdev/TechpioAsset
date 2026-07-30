import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Card, EmptyState, IconBadge, StatusPill } from '../src/components/ui';

interface MaintenanceRow {
  id: string;
  type: string;
  status: string;
  title: string;
  scheduledFor: string | null;
  asset: { assetTag: string; name: string } | null;
  vendor: { name: string } | null;
}

export default function MaintenanceScreen() {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [rows, setRows] = useState<MaintenanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.request<MaintenanceRow[]>('/maintenance?pageSize=50')) ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const tone = (s: string) =>
    s.includes('COMPLETE') ? c.success : s.includes('CANCEL') ? c.subtle : c.warning;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.background }}
      data={rows}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
      ListEmptyComponent={
        loading ? null : (
          <EmptyState icon="construct-outline" title="No maintenance records" message="Repairs and services logged against assets appear here." />
        )
      }
      renderItem={({ item }) => (
        <Card style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconBadge icon="construct-outline" tint={tone(item.status)} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
              {item.asset ? `${item.asset.name} · ${item.asset.assetTag}` : item.type}
            </Text>
            <View style={{ marginTop: 8 }}>
              <StatusPill label={item.status.replace(/_/g, ' ')} bg={c.brandSoft} fg={tone(item.status)} />
            </View>
          </View>
        </Card>
      )}
    />
  );
}
