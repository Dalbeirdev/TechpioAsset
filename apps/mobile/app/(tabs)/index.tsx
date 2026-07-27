import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, useColorScheme, View } from 'react-native';
import type { AssetStatus, AssetCondition } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { colors, statusColor, statusLabel } from '../../src/theme';

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  condition: AssetCondition;
  serialNumber: string | null;
}

/** Employee "My assets" — the equipment issued to the signed-in user. */
export default function MyAssetsScreen() {
  const { api, user } = useSession();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // api.request unwraps the envelope's `data`, so a list endpoint resolves
      // to the array itself.
      const rows = await api.request<AssetRow[]>(
        `/assets?assignedUserId=${user.id}&pageSize=100`,
      );
      setAssets(rows ?? []);
    } finally {
      setLoading(false);
    }
  }, [api, user]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <FlatList
        data={assets}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          loading ? null : (
            <Text style={{ color: c.muted, textAlign: 'center', marginTop: 40 }}>
              Nothing is assigned to you yet.
            </Text>
          )
        }
        renderItem={({ item }) => {
          const tone = statusColor(item.status, scheme);
          return (
            <Pressable
              onPress={() => router.push(`/asset/${item.id}`)}
              style={{
                backgroundColor: c.surface,
                borderColor: c.border,
                borderWidth: 1,
                borderRadius: 12,
                padding: 14,
                marginBottom: 10,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.text, fontWeight: '600', flex: 1 }}>{item.name}</Text>
                <View
                  style={{
                    backgroundColor: tone.bg,
                    borderRadius: 999,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={{ color: tone.fg, fontSize: 12 }}>{statusLabel(item.status)}</Text>
                </View>
              </View>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>
                {item.assetTag}
                {item.serialNumber ? ` · ${item.serialNumber}` : ''}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
