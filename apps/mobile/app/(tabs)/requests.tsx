import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { REQUEST_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import type { RequestStatus } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { colors } from '../../src/theme';

interface RequestRow {
  id: string;
  requestNumber: string;
  status: RequestStatus;
  businessReason: string;
}

/** Employee requests: list own requests and raise a new one. */
export default function RequestsScreen() {
  const { api } = useSession();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [item, setItem] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api.request<{ data: RequestRow[] }>('/requests?pageSize=50');
      setRows((page as unknown as { data: RequestRow[] }).data ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (reason.trim().length < 10 || item.trim().length === 0) return;
    setSubmitting(true);
    try {
      const created = await api.request<{ id: string }>('/requests', {
        method: 'POST',
        body: {
          type: 'ADDITIONAL_EQUIPMENT',
          businessReason: reason.trim(),
          items: [{ description: item.trim(), quantity: 1 }],
        },
      });
      await api.request(`/requests/${created.id}/submit`, { method: 'POST' });
      setReason('');
      setItem('');
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View
        style={{
          padding: 16,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
          backgroundColor: c.surface,
        }}
      >
        <Text style={{ color: c.text, fontWeight: '600', marginBottom: 8 }}>New request</Text>
        <TextInput
          placeholder="What do you need?"
          placeholderTextColor={c.muted}
          value={item}
          onChangeText={setItem}
          style={{
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 8,
            padding: 10,
            color: c.text,
            marginBottom: 8,
          }}
        />
        <TextInput
          placeholder="Why? (at least 10 characters)"
          placeholderTextColor={c.muted}
          value={reason}
          onChangeText={setReason}
          multiline
          style={{
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 8,
            padding: 10,
            color: c.text,
            minHeight: 60,
          }}
        />
        <Pressable
          onPress={submit}
          disabled={submitting}
          style={{ marginTop: 8, backgroundColor: c.brand, borderRadius: 8, padding: 12 }}
        >
          <Text style={{ color: c.brandText, textAlign: 'center', fontWeight: '600' }}>Submit</Text>
        </Pressable>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item: row }) => {
          const tone = palette[REQUEST_STATUS_TOKENS[row.status].tone];
          return (
            <View
              style={{
                backgroundColor: c.surface,
                borderColor: c.border,
                borderWidth: 1,
                borderRadius: 10,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.text, fontWeight: '600' }}>{row.requestNumber}</Text>
                <View
                  style={{
                    backgroundColor: tone.bg,
                    borderRadius: 999,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={{ color: tone.fg, fontSize: 12 }}>
                    {REQUEST_STATUS_TOKENS[row.status].label}
                  </Text>
                </View>
              </View>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }} numberOfLines={1}>
                {row.businessReason}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}
