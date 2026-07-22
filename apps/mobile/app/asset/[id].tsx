import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';
import type { AssetCondition, AssetStatus } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { colors, statusColor, statusLabel } from '../../src/theme';

interface AssetDetail {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  assignments: { id: string; returnedAt: string | null; acknowledgedAt: string | null }[];
}

/**
 * Asset detail — the screen a QR scan opens (spec section 15).
 *
 * Shows the authorised record, and offers the employee actions the spec lists:
 * confirm receipt, report damage, request repair. Each is a single API call the
 * server authorises; the screen only surfaces what the current user may do.
 */
export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];

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
    return <View style={{ flex: 1, backgroundColor: c.background }} />;
  }

  const tone = statusColor(asset.status, scheme);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 20 }}
    >
      <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>{asset.name}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 }}>
        <View
          style={{
            backgroundColor: tone.bg,
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 3,
          }}
        >
          <Text style={{ color: tone.fg, fontSize: 13 }}>{statusLabel(asset.status)}</Text>
        </View>
      </View>

      <View style={{ marginTop: 20, gap: 6 }}>
        <Detail c={c} label="Asset tag" value={asset.assetTag} />
        {asset.serialNumber ? <Detail c={c} label="Serial" value={asset.serialNumber} /> : null}
        {asset.brand || asset.model ? (
          <Detail
            c={c}
            label="Model"
            value={[asset.brand, asset.model].filter(Boolean).join(' ')}
          />
        ) : null}
        <Detail c={c} label="Condition" value={asset.condition} />
      </View>

      <View style={{ marginTop: 28, gap: 10 }}>
        {openAssignment && !openAssignment.acknowledgedAt ? (
          <Action c={c} label="Confirm receipt" onPress={confirmReceipt} disabled={busy} primary />
        ) : null}
        <Action c={c} label="Report damage" onPress={reportDamage} disabled={busy} />
      </View>
    </ScrollView>
  );
}

function Detail({
  c,
  label,
  value,
}: {
  c: (typeof colors)['light'];
  label: string;
  value: string;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: c.muted }}>{label}</Text>
      <Text style={{ color: c.text, fontWeight: '500' }}>{value}</Text>
    </View>
  );
}

function Action({
  c,
  label,
  onPress,
  disabled,
  primary,
}: {
  c: (typeof colors)['light'];
  label: string;
  onPress: () => void;
  disabled: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        borderRadius: 10,
        padding: 14,
        backgroundColor: primary ? c.brand : c.surface,
        borderWidth: primary ? 0 : 1,
        borderColor: c.border,
      }}
    >
      <Text
        style={{ color: primary ? c.brandText : c.text, textAlign: 'center', fontWeight: '600' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
