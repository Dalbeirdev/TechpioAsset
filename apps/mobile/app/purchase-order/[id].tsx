import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, View } from 'react-native';
import { PERMISSIONS } from '@techpioasset/domain';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { ApiError } from '../../src/lib/api-client';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, IconBadge, Screen, SectionTitle, StatusPill } from '../../src/components/ui';
import { PO_TONE, poLabel } from '../purchase-orders';

interface PoLine {
  id: string;
  lineNumber: number;
  description: string;
  quantity: string;
  receivedQuantity: string;
}
interface PoDetail {
  id: string;
  poNumber: string;
  status: string;
  currency: string;
  total: string;
  vendor: { name: string } | null;
  lines: PoLine[];
  receipts: { id: string; grnNumber: string; receivedAt: string }[];
}

/**
 * Receive goods against a PO from the loading dock. Mobile keeps intake simple:
 * lines are recorded for asset registration (STOCK put-away with location and
 * item pickers stays a web flow). Over-receipt is refused with the API's honest
 * numbers - no override on mobile either.
 */
export default function PurchaseOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [po, setPo] = useState<PoDetail | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const canReceive = !!user?.permissions.includes(PERMISSIONS.PROCUREMENT_RECEIVE);

  const load = useCallback(async () => {
    setPo(await api.request<PoDetail>(`/procurement/orders/${id}`));
  }, [api, id]);
  useEffect(() => void load(), [load]);

  async function receive() {
    if (!po) return;
    const lines = Object.entries(qty)
      .map(([purchaseOrderLineId, value]) => ({ purchaseOrderLineId, quantity: Number(value) }))
      .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0)
      .map((l) => ({ ...l, intake: 'ASSET' as const }));
    if (lines.length === 0) return;

    setBusy(true);
    try {
      await api.request(`/procurement/orders/${po.id}/receive`, {
        method: 'POST',
        body: { lines },
      });
      setQty({});
      await load();
      Alert.alert('Goods received', 'The delivery is on record and the order status updated.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // The over-receipt guard speaking - honest outstanding numbers.
        Alert.alert('Over-receipt refused', error.message);
      } else {
        Alert.alert('Could not receive', error instanceof Error ? error.message : 'Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!po) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const tone = palette[PO_TONE[po.status] ?? 'neutral'];
  const receivable = canReceive && (po.status === 'ISSUED' || po.status === 'PARTIALLY_RECEIVED');
  const anyQty = Object.values(qty).some((v) => Number(v) > 0);

  return (
    <Screen scroll>
      <Card style={{ marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconBadge icon="cube-outline" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>{po.poNumber}</Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>
              {[po.vendor?.name, `${Number(po.total).toLocaleString()} ${po.currency}`]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: spacing.md }}>
          <StatusPill label={poLabel(po.status)} bg={tone.bg} fg={tone.fg} />
        </View>
      </Card>

      <SectionTitle>Lines</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {po.lines.map((line, i) => {
          const ordered = Number(line.quantity);
          const received = Number(line.receivedQuantity);
          const remaining = Math.max(0, ordered - received);
          const pct = ordered ? Math.min(1, received / ordered) : 0;
          return (
            <View
              key={line.id}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: i === po.lines.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                    {line.description}
                  </Text>
                  <Text
                    style={{
                      color: remaining === 0 ? c.muted : c.text,
                      fontSize: 12,
                      marginTop: 2,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {received}/{ordered} received{remaining > 0 ? ` · ${remaining} outstanding` : ' · complete'}
                  </Text>
                  <View
                    style={{
                      marginTop: 6,
                      height: 5,
                      borderRadius: 99,
                      backgroundColor: c.border,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.round(pct * 100)}%`,
                        height: '100%',
                        backgroundColor: pct >= 1 ? palette.success.fg : c.brand,
                      }}
                    />
                  </View>
                </View>
                {receivable && remaining > 0 ? (
                  <TextInput
                    value={qty[line.id] ?? ''}
                    onChangeText={(value) => setQty((prev) => ({ ...prev, [line.id]: value }))}
                    placeholder="0"
                    placeholderTextColor={c.muted}
                    keyboardType="number-pad"
                    accessibilityLabel={`Receive quantity for line ${line.lineNumber}`}
                    style={{
                      color: c.text,
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      minWidth: 64,
                      textAlign: 'center',
                      fontSize: 15,
                    }}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>

      {receivable ? (
        <Button
          label="Receive goods"
          icon="checkmark-done-outline"
          onPress={() => void receive()}
          loading={busy}
          disabled={!anyQty}
        />
      ) : null}

      {po.receipts.length > 0 ? (
        <>
          <SectionTitle>Receipts</SectionTitle>
          <Card style={{ padding: 0 }}>
            {po.receipts.map((r, i) => (
              <View
                key={r.id}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderBottomWidth: i === po.receipts.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 13 }}>{r.grnNumber}</Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>
                  {new Date(r.receivedAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
