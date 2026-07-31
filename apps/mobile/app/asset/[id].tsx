import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import type {
  AssetCondition,
  AssetStatus,
  LifecycleState,
  AvailabilityState,
  OwnershipType,
} from '@techpioasset/domain';
import {
  LIFECYCLE_STATE_TOKENS,
  AVAILABILITY_STATE_TOKENS,
  OWNERSHIP_TYPE_TOKENS,
  TONE_PALETTE_DARK,
  TONE_PALETTE_LIGHT,
} from '@techpioasset/ui-tokens';
import { useSession } from '../../src/providers/session';
import { useTheme, statusColor, statusLabel } from '../../src/theme';
import { Button, Card, IconBadge, Screen, SectionTitle, StatusPill } from '../../src/components/ui';

interface AssetDetail {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  // v2.1 Workstream A — nullable until backfilled / dual-written.
  lifecycleState: LifecycleState | null;
  availabilityState: AvailabilityState | null;
  ownershipType: OwnershipType | null;
  assignments: { id: string; returnedAt: string | null; acknowledgedAt: string | null }[];
}

/** Asset detail — the screen a QR scan opens (spec section 15). */
export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const { c, scheme, spacing } = useTheme();

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api.request<AssetDetail>(`/assets/${id}`);
    setAsset(data);
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAssignment = asset?.assignments.find((a) => a.returnedAt === null);

  async function confirmReceipt() {
    if (!openAssignment) return;
    setBusy(true);
    try {
      await api.request(`/assets/assignments/${openAssignment.id}/acknowledge`, { method: 'POST' });
      await load();
      Alert.alert('Receipt confirmed', 'Thanks — this asset is now marked as in use.');
    } finally {
      setBusy(false);
    }
  }

  async function reportDamage() {
    if (!asset) return;
    setBusy(true);
    try {
      await api.request(`/assets/${asset.id}/status`, {
        method: 'POST',
        body: { status: 'DAMAGED', reason: 'Reported damaged from mobile' },
      });
      await load();
      Alert.alert('Reported', 'IT has been notified this asset is damaged.');
    } catch {
      Alert.alert('Could not report', 'You may not have permission to change this asset.');
    } finally {
      setBusy(false);
    }
  }

  if (!asset) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const tone = statusColor(asset.status, scheme);
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  return (
    <Screen scroll>
      <Card style={{ marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconBadge icon="hardware-chip-outline" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>{asset.name}</Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>{asset.assetTag}</Text>
          </View>
        </View>
        <View
          style={{ marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}
        >
          <StatusPill label={statusLabel(asset.status)} bg={tone.bg} fg={tone.fg} />
          {asset.lifecycleState ? (
            <StatusPill
              label={LIFECYCLE_STATE_TOKENS[asset.lifecycleState].label}
              bg={palette[LIFECYCLE_STATE_TOKENS[asset.lifecycleState].tone].bg}
              fg={palette[LIFECYCLE_STATE_TOKENS[asset.lifecycleState].tone].fg}
            />
          ) : null}
          {asset.availabilityState ? (
            <StatusPill
              label={AVAILABILITY_STATE_TOKENS[asset.availabilityState].label}
              bg={palette[AVAILABILITY_STATE_TOKENS[asset.availabilityState].tone].bg}
              fg={palette[AVAILABILITY_STATE_TOKENS[asset.availabilityState].tone].fg}
            />
          ) : null}
          {asset.ownershipType ? (
            <StatusPill
              label={OWNERSHIP_TYPE_TOKENS[asset.ownershipType].label}
              bg={palette[OWNERSHIP_TYPE_TOKENS[asset.ownershipType].tone].bg}
              fg={palette[OWNERSHIP_TYPE_TOKENS[asset.ownershipType].tone].fg}
            />
          ) : null}
        </View>
      </Card>

      <SectionTitle>Details</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {asset.serialNumber ? <DetailRow label="Serial" value={asset.serialNumber} /> : null}
        {asset.brand || asset.model ? (
          <DetailRow label="Model" value={[asset.brand, asset.model].filter(Boolean).join(' ')} />
        ) : null}
        <DetailRow label="Condition" value={asset.condition} last />
      </Card>

      {openAssignment && !openAssignment.acknowledgedAt ? (
        <Button
          label="Confirm receipt"
          icon="checkmark-circle-outline"
          onPress={confirmReceipt}
          loading={busy}
          style={{ marginBottom: spacing.md }}
        />
      ) : null}
      <Button label="Report damage" icon="warning-outline" variant="danger" onPress={reportDamage} disabled={busy} />
    </Screen>
  );
}

function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <Text style={{ color: c.muted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{value}</Text>
    </View>
  );
}
