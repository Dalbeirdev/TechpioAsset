import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { PERMISSIONS, type AssetStatus, type AssetCondition } from '@techpioasset/domain';
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
} from '../../src/components/ui';

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  condition: AssetCondition;
  serialNumber: string | null;
}

/** Home: a quick overview plus the equipment issued to the signed-in user. */
export default function HomeScreen() {
  const { api, user } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [requestCount, setRequestCount] = useState(0);
  const [approvalCount, setApprovalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const canApprove = !!user?.permissions.includes(PERMISSIONS.REQUESTS_APPROVE);
  const firstName = (user?.displayName ?? user?.email ?? '').split(/[\s@]/)[0] || 'there';

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [mine, reqs, approvals] = await Promise.all([
        api.request<AssetRow[]>(`/assets?assignedUserId=${user.id}&pageSize=100`),
        api.request<unknown[]>('/requests?pageSize=50').catch(() => []),
        canApprove
          ? api.request<unknown[]>('/requests?awaitingMe=true&pageSize=50').catch(() => [])
          : Promise.resolve([]),
      ]);
      setAssets(mine ?? []);
      setRequestCount((reqs ?? []).length);
      setApprovalCount((approvals ?? []).length);
    } finally {
      setLoading(false);
    }
  }, [api, user, canApprove]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={{ color: c.muted, fontSize: 14 }}>Welcome back,</Text>
      <Text style={{ color: c.text, fontSize: 24, fontWeight: '800', marginBottom: spacing.lg }}>
        {firstName}
      </Text>

      <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl }}>
        <StatCard icon="cube-outline" value={assets.length} label="My assets" />
        <StatCard
          icon="document-text-outline"
          value={requestCount}
          label="My requests"
          onPress={() => router.push('/(tabs)/requests')}
        />
        {canApprove ? (
          <StatCard
            icon="checkmark-done-outline"
            value={approvalCount}
            label="To approve"
            tint={approvalCount > 0 ? c.warning : undefined}
            onPress={() => router.push('/(tabs)/approvals')}
          />
        ) : null}
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
