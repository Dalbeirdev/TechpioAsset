import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type {
  AssetStatus,
  AssetCondition,
  LifecycleState,
  AvailabilityState,
  OwnershipType,
} from '@techpioasset/domain';
import {
  LIFECYCLE_STATE_TOKENS,
  AVAILABILITY_STATE_TOKENS,
  TONE_PALETTE_DARK,
  TONE_PALETTE_LIGHT,
} from '@techpioasset/ui-tokens';
import { Ionicons } from '@expo/vector-icons';
import { MAX_PAGE_SIZE } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme, statusColor, statusLabel } from '../../src/theme';
import { Card, Chevron, EmptyState, Field, IconBadge, StatusPill } from '../../src/components/ui';

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  condition: AssetCondition;
  // v2.1 Workstream A — nullable until backfilled / dual-written.
  lifecycleState: LifecycleState | null;
  availabilityState: AvailabilityState | null;
  ownershipType: OwnershipType | null;
  serialNumber: string | null;
  category: { name: string } | null;
  assignedUser: { profile: { displayName: string | null } | null } | null;
}

/** All company assets — searchable list, tap to open the asset. */
export default function AssetsScreen() {
  const { api, user } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The page size comes from the contract the server validates against.
      // Asking for 200 was rejected as 422 and, with nothing catching it, the
      // list rendered its empty state - so the tab looked like a company with
      // no assets rather than a request that never succeeded.
      const data = await api.request<AssetRow[]>(`/assets?pageSize=${MAX_PAGE_SIZE}`);
      setRows(data ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
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

  const mayCreate = user?.permissions.includes(PERMISSIONS.ASSETS_CREATE) ?? false;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
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
        loading ? null : failed ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Could not load assets"
            message="Pull down to try again."
          />
        ) : (
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
              <View
                style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}
              >
                <StatusPill label={statusLabel(item.status)} bg={tone.bg} fg={tone.fg} />
                {item.lifecycleState
                  ? (() => {
                      const t = palette[LIFECYCLE_STATE_TOKENS[item.lifecycleState].tone];
                      return (
                        <StatusPill
                          label={LIFECYCLE_STATE_TOKENS[item.lifecycleState].label}
                          bg={t.bg}
                          fg={t.fg}
                        />
                      );
                    })()
                  : null}
                {item.availabilityState
                  ? (() => {
                      const t = palette[AVAILABILITY_STATE_TOKENS[item.availabilityState].tone];
                      return (
                        <StatusPill
                          label={AVAILABILITY_STATE_TOKENS[item.availabilityState].label}
                          bg={t.bg}
                          fg={t.fg}
                        />
                      );
                    })()
                  : null}
              </View>
            </View>
            <Chevron />
          </Card>
        );
      }}
    />

    {/* Registering kit is done standing next to it, so it is one tap from the
        list rather than buried in a menu. */}
    {mayCreate ? (
      <Pressable
        onPress={() => router.push('/asset/new')}
        accessibilityLabel="Register an asset"
        style={{
          position: 'absolute',
          right: spacing.lg,
          bottom: spacing.lg,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: c.brand,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 5,
        }}
      >
        <Ionicons name="add" size={28} color={c.brandText} />
      </Pressable>
    ) : null}
    </View>
  );
}
