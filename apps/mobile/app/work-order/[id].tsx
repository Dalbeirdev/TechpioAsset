import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { ApiError } from '../../src/lib/api-client';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, Field, IconBadge, Screen, SectionTitle, StatusPill } from '../../src/components/ui';
import { WO_TONE, isSlaOverdue, woLabel } from '../work-orders';

/**
 * v2.5 H6 - the technician's work-order detail: start / hold / resume /
 * complete, diagnosis notes, and part draw through the v2.4 guarded stock.
 * A refused draw shows the API's honest numbers in an alert - nothing moves.
 */

interface PartRow {
  id: string;
  quantity: string;
  reason: string | null;
  inventoryItem: { id: string; sku: string; name: string; unit: string };
}

interface WoDetail {
  id: string;
  type: string;
  status: string;
  title: string;
  description: string | null;
  diagnosis: string | null;
  slaDueAt: string | null;
  escalatedAt: string | null;
  technicianId: string | null;
  completedAt: string | null;
  resolutionNotes: string | null;
  asset: { id: string; assetTag: string; name: string } | null;
  parts: PartRow[];
}

interface StockItem {
  id: string;
  sku: string;
  name: string;
}
interface StockLocation {
  id: string;
  code: string;
  name: string;
}

export default function WorkOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [wo, setWo] = useState<WoDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<StockItem[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [itemId, setItemId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [qty, setQty] = useState('1');

  const load = useCallback(async () => {
    setWo(await api.request<WoDetail>(`/maintenance/${id}`));
  }, [api, id]);
  useEffect(() => void load(), [load]);

  // Stock pickers load lazily and fail soft: a technician without inventory
  // read simply does not see the part-draw card.
  useEffect(() => {
    void (async () => {
      try {
        setItems((await api.request<StockItem[]>('/stock/items')) ?? []);
        setLocations((await api.request<StockLocation[]>('/stock/locations')) ?? []);
      } catch {
        /* no inventory visibility - the card stays hidden */
      }
    })();
  }, [api]);

  async function act(path: string, body?: unknown, method: 'POST' | 'PATCH' = 'POST') {
    setBusy(true);
    try {
      await api.request(`/maintenance/${id}/${path}`, { method, body: body ?? {} });
      await load();
    } catch (error) {
      Alert.alert('Could not update', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function drawPart() {
    setBusy(true);
    try {
      await api.request(`/maintenance/${id}/consume-part`, {
        method: 'POST',
        body: { inventoryItemId: itemId, stockLocationId: locationId, quantity: Number(qty) },
      });
      setQty('1');
      await load();
      Alert.alert('Part drawn', 'The stock ledger records it against this work order.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // The guarded take speaking - honest numbers, nothing moved.
        Alert.alert('Draw refused', error.message);
      } else {
        Alert.alert('Could not draw the part', error instanceof Error ? error.message : 'Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!wo) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const tone = palette[WO_TONE[wo.status] ?? 'neutral'];
  const overdue = isSlaOverdue(wo);
  const open = !['COMPLETED', 'CANCELLED', 'FAILED'].includes(wo.status);
  const working = wo.status === 'IN_PROGRESS' || wo.status === 'ON_HOLD';

  return (
    <Screen scroll>
      <Card style={{ marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconBadge icon="build-outline" tint={overdue ? c.danger : undefined} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{wo.title}</Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>
              {[wo.asset ? `${wo.asset.assetTag}` : null, wo.type.toLowerCase()]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}>
          <StatusPill label={woLabel(wo.status)} bg={tone.bg} fg={tone.fg} />
          {wo.slaDueAt ? (
            <StatusPill
              label={
                overdue
                  ? `SLA overdue${wo.escalatedAt ? ' · escalated' : ''}`
                  : `due ${new Date(wo.slaDueAt).toLocaleDateString()}`
              }
              bg={overdue ? palette.critical.bg : palette.info.bg}
              fg={overdue ? palette.critical.fg : palette.info.fg}
            />
          ) : null}
        </View>
        {wo.description ? (
          <Text style={{ color: c.muted, fontSize: 13, marginTop: spacing.md }}>{wo.description}</Text>
        ) : null}
      </Card>

      {wo.diagnosis ? (
        <>
          <SectionTitle>Diagnosis</SectionTitle>
          <Card style={{ marginBottom: spacing.xl }}>
            <Text style={{ color: c.text, fontSize: 13, lineHeight: 19 }}>{wo.diagnosis}</Text>
          </Card>
        </>
      ) : null}

      {wo.parts.length > 0 ? (
        <>
          <SectionTitle>Parts used</SectionTitle>
          <Card style={{ padding: 0, marginBottom: spacing.xl }}>
            {wo.parts.map((part, i) => (
              <View
                key={part.id}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderBottomWidth: i === wo.parts.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 13, flex: 1 }} numberOfLines={1}>
                  {part.inventoryItem.name}
                </Text>
                <Text style={{ color: c.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                  {Number(part.quantity)} {part.inventoryItem.unit}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {wo.completedAt ? (
        <>
          <SectionTitle>Outcome</SectionTitle>
          <Card style={{ marginBottom: spacing.xl }}>
            <Text style={{ color: c.muted, fontSize: 13 }}>
              Completed {new Date(wo.completedAt).toLocaleDateString()}.
              {wo.resolutionNotes ? ` ${wo.resolutionNotes}` : ''}
            </Text>
          </Card>
        </>
      ) : null}

      {open ? (
        <>
          <SectionTitle>Update diagnosis</SectionTitle>
          <Card style={{ marginBottom: spacing.xl }}>
            <Field
              label="What did you find?"
              value={diagnosis}
              onChangeText={setDiagnosis}
              placeholder={wo.diagnosis ?? 'Worn battery, loose fan cable…'}
              multiline
            />
            <Button
              label="Save diagnosis"
              variant="secondary"
              icon="create-outline"
              loading={busy}
              disabled={!diagnosis.trim()}
              onPress={() => void act('diagnosis', { diagnosis }, 'PATCH').then(() => setDiagnosis(''))}
            />
          </Card>
        </>
      ) : null}

      {working && items.length > 0 && locations.length > 0 ? (
        <>
          <SectionTitle>Draw a part</SectionTitle>
          <Card style={{ marginBottom: spacing.xl }}>
            <Text style={{ color: c.muted, fontSize: 12, marginBottom: 8 }}>Part</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
              {items.map((item) => (
                <Choice
                  key={item.id}
                  label={item.name}
                  selected={itemId === item.id}
                  onPress={() => setItemId(item.id)}
                />
              ))}
            </View>
            <Text style={{ color: c.muted, fontSize: 12, marginBottom: 8 }}>From location</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
              {locations.map((loc) => (
                <Choice
                  key={loc.id}
                  label={loc.code}
                  selected={locationId === loc.id}
                  onPress={() => setLocationId(loc.id)}
                />
              ))}
            </View>
            <Field
              label="Quantity"
              value={qty}
              onChangeText={setQty}
              keyboardType="number-pad"
              accessibilityLabel="Part quantity"
            />
            <Button
              label="Draw part"
              icon="download-outline"
              loading={busy}
              disabled={!itemId || !locationId || !/^\d+$/.test(qty) || Number(qty) < 1}
              onPress={() => void drawPart()}
            />
          </Card>
        </>
      ) : null}

      {open ? (
        <>
          <SectionTitle>Actions</SectionTitle>
          <View style={{ gap: spacing.md }}>
            {wo.status === 'REQUESTED' || wo.status === 'SCHEDULED' ? (
              <Button label="Start work" icon="play-outline" loading={busy} onPress={() => void act('start')} />
            ) : null}
            {wo.status === 'IN_PROGRESS' ? (
              <Button
                label="Put on hold"
                variant="secondary"
                icon="pause-outline"
                loading={busy}
                onPress={() => void act('hold')}
              />
            ) : null}
            {wo.status === 'ON_HOLD' ? (
              <Button label="Resume work" icon="play-outline" loading={busy} onPress={() => void act('resume')} />
            ) : null}
            {wo.status === 'IN_PROGRESS' ? (
              <>
                <Field
                  label="Resolution notes (optional)"
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Replaced the battery, tested charge…"
                  multiline
                />
                <Button
                  label="Complete and return to service"
                  icon="checkmark-done-outline"
                  loading={busy}
                  onPress={() =>
                    void act('complete', {
                      ...(notes ? { resolutionNotes: notes } : {}),
                      replacementRecommended: false,
                      restoreAsset: true,
                    })
                  }
                />
              </>
            ) : null}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 99,
        backgroundColor: selected ? c.brand : c.surface,
        borderWidth: 1,
        borderColor: selected ? c.brand : c.border,
      }}
    >
      <Text style={{ color: selected ? c.brandText : c.muted, fontSize: 12, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}
