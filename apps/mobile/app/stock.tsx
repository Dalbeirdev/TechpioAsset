import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Card, EmptyState, IconBadge } from '../src/components/ui';

interface Level {
  id: string;
  quantity: string;
  reserved: string;
  inventoryItem: { id: string; sku: string; name: string; unit: string; minStock: string | null };
  stockLocation: { id: string; code: string; name: string };
}

/** Stock by location — on hand, reserved and what is actually free. */
export default function StockScreen() {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [rows, setRows] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationId, setLocationId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // v2.10 S2: /stock/levels is paginated now, so the payload is enveloped.
      const page = await api.request<{ data: Level[] }>('/stock/levels?pageSize=50');
      setRows(page?.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const locations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.stockLocation.id, r.stockLocation.name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const visible = locationId ? rows.filter((r) => r.stockLocation.id === locationId) : rows;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {locations.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: 8 }}
        >
          {[{ id: null as string | null, name: 'All locations' }, ...locations].map((l) => {
            const active = locationId === l.id;
            return (
              <Pressable
                key={l.id ?? 'all'}
                onPress={() => setLocationId(l.id)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: active ? c.brand : c.card,
                  borderWidth: 1,
                  borderColor: active ? c.brand : c.border,
                }}
              >
                <Text style={{ color: active ? '#fff' : c.muted, fontSize: 13, fontWeight: '600' }}>
                  {l.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <FlatList
        style={{ flex: 1 }}
        data={visible}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="layers-outline"
              title="No stock recorded"
              message="Receive a purchase order into a location, and levels appear here."
            />
          )
        }
        renderItem={({ item }) => {
          const qty = Number(item.quantity);
          const reserved = Number(item.reserved);
          const free = Math.max(0, qty - reserved);
          const low = item.inventoryItem.minStock !== null && qty <= Number(item.inventoryItem.minStock);
          return (
            <Card style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <IconBadge icon="layers-outline" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                  {item.inventoryItem.name}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {item.inventoryItem.sku} · {item.stockLocation.name}
                </Text>
                <Text
                  style={{
                    color: low ? c.danger : c.muted,
                    fontSize: 12,
                    marginTop: 4,
                    fontWeight: low ? '700' : '400',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {qty} on hand · {reserved} reserved · {free} free
                  {low ? ' · LOW' : ''}
                </Text>
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
}
