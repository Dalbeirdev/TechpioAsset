import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import type { AssetStatus, AssetCondition } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme, statusColor, statusLabel } from '../../src/theme';
import {
  Card,
  Chevron,
  EmptyState,
  IconBadge,
  Screen,
  SectionTitle,
  StatCard,
  StatusPill,
  type IconName,
} from '../../src/components/ui';

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  condition: AssetCondition;
  serialNumber: string | null;
}

interface Tile {
  key: string;
  label: string;
  value: number;
  icon: string;
  tone: 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';
}

// Server (Lucide) icon names → Ionicons.
const TILE_ICON: Record<string, IconName> = {
  Boxes: 'cube-outline',
  ClipboardList: 'document-text-outline',
  UserCheck: 'checkmark-done-outline',
  Layers: 'layers-outline',
  ShieldAlert: 'shield-outline',
  Wrench: 'construct-outline',
  KeyRound: 'key-outline',
};
// Tile key → mobile route (my-assets stays on Home).
const TILE_ROUTE: Record<string, string> = {
  'my-open-requests': '/(tabs)/requests',
  'awaiting-approval': '/(tabs)/approvals',
  'assets-total': '/(tabs)/assets',
  'warranty-expiring': '/(tabs)/assets',
  'open-maintenance': '/maintenance',
  'licenses-expiring': '/licenses',
};

/** Home: role-aware KPI tiles plus the equipment issued to the signed-in user. */
export default function HomeScreen() {
  const { api, user } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);

  const firstName = (user?.displayName ?? user?.email ?? '').split(/[\s@]/)[0] || 'there';

  const tileTint = (tone: Tile['tone']): string | undefined =>
    tone === 'warning' ? c.warning : tone === 'danger' ? c.danger : undefined;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [mine, summary] = await Promise.all([
        api.request<AssetRow[]>(`/assets?assignedUserId=${user.id}&pageSize=100`),
        api.request<{ tiles: Tile[] }>('/dashboard').catch(() => ({ tiles: [] })),
      ]);
      setAssets(mine ?? []);
      setTiles(summary?.tiles ?? []);
    } finally {
      setLoading(false);
    }
  }, [api, user]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={{ color: c.muted, fontSize: 14 }}>Welcome back,</Text>
      <Text style={{ color: c.text, fontSize: 24, fontWeight: '800', marginBottom: spacing.lg }}>
        {firstName}
      </Text>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.md,
          marginBottom: spacing.xl,
        }}
      >
        {tiles.map((tile) => {
          const route = TILE_ROUTE[tile.key];
          return (
            <View key={tile.key} style={{ width: '47%' }}>
              <StatCard
                icon={TILE_ICON[tile.icon] ?? 'ellipse-outline'}
                value={tile.value}
                label={tile.label}
                tint={tileTint(tile.tone)}
                onPress={route ? () => router.push(route as never) : undefined}
              />
            </View>
          );
        })}
      </View>

      <SectionTitle>My assets</SectionTitle>
      {assets.length === 0 && !loading ? (
        <Card>
          <EmptyState
            icon="cube-outline"
            title="No assets yet"
            message="Equipment issued to you will appear here."
          />
        </Card>
      ) : (
        assets.map((item) => {
          const tone = statusColor(item.status, scheme);
          return (
            <Card
              key={item.id}
              onPress={() => router.push(`/asset/${item.id}`)}
              style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
            >
              <IconBadge icon="hardware-chip-outline" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {item.assetTag}
                  {item.serialNumber ? ` · ${item.serialNumber}` : ''}
                </Text>
                <View style={{ marginTop: 8 }}>
                  <StatusPill label={statusLabel(item.status)} bg={tone.bg} fg={tone.fg} />
                </View>
              </View>
              <Chevron />
            </Card>
          );
        })
      )}
    </Screen>
  );
}
