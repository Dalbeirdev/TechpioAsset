import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { MAX_PAGE_SIZE } from '@techpioasset/contracts';
import type { AssetCondition } from '@techpioasset/domain';
import { useSession } from '../providers/session';
import { useTheme } from '../theme';
import { Avatar, Button, Field } from './ui';

/**
 * Handing equipment over, from the phone.
 *
 * This is the job the mobile app was missing: IT stands next to the person and
 * the laptop, and until now had to walk back to a desk to record it. The three
 * moves the API already supports are one sheet, because they are one moment -
 * whether it is a hand-out, a hand-back or a straight swap depends only on
 * whether the asset currently has a holder.
 *
 * Condition is asked for, not assumed. It is the field that makes a return
 * worth recording: "who has it" can be reconstructed later, "what state was it
 * in when it changed hands" cannot.
 */

export type HandoverMode = 'assign' | 'return' | 'reassign';

const CONDITIONS: { value: AssetCondition; label: string }[] = [
  { value: 'NEW', label: 'New' },
  { value: 'GOOD', label: 'Good' },
  { value: 'FAIR', label: 'Fair' },
  { value: 'POOR', label: 'Poor' },
  { value: 'DAMAGED', label: 'Damaged' },
];

interface Person {
  id: string;
  email: string;
  profile: { firstName: string | null; lastName: string | null; displayName: string | null } | null;
}

const nameOf = (p: Person) =>
  p.profile?.displayName ??
  [p.profile?.firstName, p.profile?.lastName].filter(Boolean).join(' ') ??
  p.email;

export function HandoverSheet({
  visible,
  mode,
  assetId,
  assetName,
  holderName,
  onClose,
  onDone,
}: {
  visible: boolean;
  mode: HandoverMode;
  assetId: string;
  assetName: string;
  holderName?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { api } = useSession();
  const { c, spacing, radius } = useTheme();

  const [people, setPeople] = useState<Person[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [q, setQ] = useState('');
  const [personId, setPersonId] = useState<string | null>(null);
  const [condition, setCondition] = useState<AssetCondition>('GOOD');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsPerson = mode !== 'return';

  const loadPeople = useCallback(async () => {
    setLoadingPeople(true);
    try {
      const rows = await api.request<Person[]>(`/users?pageSize=${MAX_PAGE_SIZE}`);
      setPeople(rows ?? []);
    } catch {
      setPeople([]);
    } finally {
      setLoadingPeople(false);
    }
  }, [api]);

  useEffect(() => {
    if (!visible) return;
    setPersonId(null);
    setNotes('');
    setQ('');
    setError(null);
    setCondition('GOOD');
    if (needsPerson) void loadPeople();
  }, [visible, needsPerson, loadPeople]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return people.slice(0, 40);
    return people
      .filter((p) => nameOf(p).toLowerCase().includes(t) || p.email.toLowerCase().includes(t))
      .slice(0, 40);
  }, [people, q]);

  const copy = {
    assign: { title: 'Assign this asset', cta: 'Assign', conditionLabel: 'Condition going out' },
    return: { title: 'Take this asset back', cta: 'Take back', conditionLabel: 'Condition coming back' },
    reassign: { title: 'Hand to someone else', cta: 'Hand over', conditionLabel: 'Condition coming back' },
  }[mode];

  async function submit() {
    if (needsPerson && !personId) {
      setError('Choose who it is going to.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const trimmed = notes.trim() || undefined;
      if (mode === 'assign') {
        await api.request(`/assets/${assetId}/assign`, {
          method: 'POST',
          body: { userId: personId, conditionOut: condition, notes: trimmed },
        });
      } else if (mode === 'return') {
        await api.request(`/assets/${assetId}/return`, {
          method: 'POST',
          body: { conditionIn: condition, resultingStatus: 'AVAILABLE', notes: trimmed },
        });
      } else {
        // One transaction on the server, so the asset is never briefly nobody's.
        await api.request(`/assets/${assetId}/reassign`, {
          method: 'POST',
          body: { userId: personId, conditionIn: condition, notes: trimmed },
        });
      }
      onDone();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'That did not go through. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(2,6,23,0.45)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: c.background,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            maxHeight: '92%',
            paddingBottom: spacing.xl,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: spacing.lg,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{copy.title}</Text>
              <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
                {assetName}
                {holderName ? ` · with ${holderName}` : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={c.muted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
            {needsPerson ? (
              <>
                <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
                  {mode === 'reassign' ? 'Hand it to' : 'Assign to'}
                </Text>
                <Field placeholder="Search people by name or email" value={q} onChangeText={setQ} />
                {loadingPeople ? (
                  <ActivityIndicator color={c.brand} style={{ marginVertical: spacing.lg }} />
                ) : (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: radius.md,
                      overflow: 'hidden',
                      marginBottom: spacing.lg,
                    }}
                  >
                    {filtered.length === 0 ? (
                      <Text style={{ color: c.subtle, fontSize: 13, padding: spacing.lg }}>
                        No one matches that.
                      </Text>
                    ) : (
                      filtered.map((p, i) => {
                        const active = personId === p.id;
                        return (
                          <Pressable
                            key={p.id}
                            onPress={() => setPersonId(p.id)}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: spacing.md,
                              padding: spacing.md,
                              backgroundColor: active ? `${c.brand}14` : c.card,
                              borderBottomWidth: i === filtered.length - 1 ? 0 : 1,
                              borderBottomColor: c.border,
                            }}
                          >
                            <Avatar name={nameOf(p)} size={34} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                                {nameOf(p)}
                              </Text>
                              <Text style={{ color: c.subtle, fontSize: 12 }} numberOfLines={1}>
                                {p.email}
                              </Text>
                            </View>
                            {active ? <Ionicons name="checkmark-circle" size={20} color={c.brand} /> : null}
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                )}
              </>
            ) : null}

            <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
              {copy.conditionLabel}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg }}>
              {CONDITIONS.map(({ value, label }) => {
                const active = condition === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setCondition(value)}
                    style={{
                      paddingVertical: 9,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: active ? c.brand : c.border,
                      backgroundColor: active ? `${c.brand}14` : c.card,
                    }}
                  >
                    <Text style={{ color: active ? c.brand : c.text, fontSize: 13, fontWeight: '600' }}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Field
              label="Notes (optional)"
              placeholder={
                mode === 'return' ? 'Anything missing or damaged?' : 'Accessories issued, expected return…'
              }
              value={notes}
              onChangeText={setNotes}
              multiline
            />

            {error ? (
              <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text>
            ) : null}

            <Button label={copy.cta} onPress={submit} loading={busy} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
