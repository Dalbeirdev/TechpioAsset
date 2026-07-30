import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import {
  REQUEST_STATUS_TOKENS,
  TONE_PALETTE_DARK,
  TONE_PALETTE_LIGHT,
} from '@techpioasset/ui-tokens';
import type { RequestStatus } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import {
  Button,
  Card,
  Chevron,
  EmptyState,
  Field,
  IconBadge,
  SectionTitle,
  StatusPill,
} from '../../src/components/ui';

interface RequestRow {
  id: string;
  requestNumber: string;
  status: RequestStatus;
  businessReason: string;
}

/** Employee requests: raise a new one and track your own. */
export default function RequestsScreen() {
  const { api } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [item, setItem] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.request<RequestRow[]>('/requests?pageSize=50');
      setRows(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const canSubmit = reason.trim().length >= 10 && item.trim().length > 0;

  async function submit() {
    if (!canSubmit) return;
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
    <FlatList
      style={{ flex: 1, backgroundColor: c.background }}
      data={rows}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      ListHeaderComponent={
        <View style={{ marginBottom: spacing.xl }}>
          <Card>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 16, marginBottom: spacing.md }}>
              New request
            </Text>
            <Field label="What do you need?" placeholder="e.g. Laptop docking station" value={item} onChangeText={setItem} />
            <Field
              label="Business reason"
              placeholder="At least 10 characters"
              value={reason}
              onChangeText={setReason}
              multiline
              style={undefined}
            />
            <Button label="Submit request" icon="send" onPress={submit} loading={submitting} disabled={!canSubmit} />
          </Card>
          <View style={{ height: spacing.xl }} />
          <SectionTitle>Your requests</SectionTitle>
        </View>
      }
      ListEmptyComponent={
        loading ? null : (
          <Card>
            <EmptyState icon="document-text-outline" title="No requests yet" message="Requests you raise will appear here." />
          </Card>
        )
      }
      renderItem={({ item: row }) => {
        const tone = palette[REQUEST_STATUS_TOKENS[row.status].tone];
        return (
          <Card
            onPress={() => router.push(`/request/${row.id}`)}
            style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <IconBadge icon="document-text-outline" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>{row.requestNumber}</Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {row.businessReason}
              </Text>
              <View style={{ marginTop: 8 }}>
                <StatusPill label={REQUEST_STATUS_TOKENS[row.status].label} bg={tone.bg} fg={tone.fg} />
              </View>
            </View>
            <Chevron />
          </Card>
        );
      }}
    />
  );
}
