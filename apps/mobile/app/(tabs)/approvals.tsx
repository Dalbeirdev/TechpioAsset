import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, useColorScheme, View } from 'react-native';
import { REQUEST_STATUS_TOKENS, TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import type { RequestStatus } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { colors } from '../../src/theme';
import { personName, formatMoney } from '../../src/lib/format';

interface ApprovalRow {
  id: string;
  requestNumber: string;
  status: RequestStatus;
  businessReason: string;
  estimatedCost: string | null;
  currency: string;
  requester: {
    email: string;
    profile: { firstName: string | null; lastName: string | null } | null;
  } | null;
  items: { id: string; description: string; quantity: number }[];
}

/**
 * Approvals inbox — requests currently awaiting the signed-in approver's decision.
 *
 * The tab is only shown to holders of requests:approve, and the API's
 * awaitingMe=true filter returns exactly the steps this user is the approver for
 * (named, role-based, or line-manager), so the list never leaks requests the
 * user cannot act on. Tapping a card opens the request to approve or reject.
 */
export default function ApprovalsScreen() {
  const { api } = useSession();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api.request<{ data: ApprovalRow[] }>(
        '/requests?awaitingMe=true&pageSize=50',
      );
      setRows(page.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  // Reload whenever the tab regains focus, so a decision made on the detail
  // screen removes the request from the inbox on return.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          loading ? null : (
            <Text style={{ color: c.muted, textAlign: 'center', marginTop: 40 }}>
              Nothing is waiting on your approval.
            </Text>
          )
        }
        renderItem={({ item }) => {
          const tone = palette[REQUEST_STATUS_TOKENS[item.status].tone];
          const summary = item.items
            .map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.description}` : i.description))
            .join(', ');
          return (
            <Pressable
              onPress={() => router.push(`/request/${item.id}`)}
              style={{
                backgroundColor: c.surface,
                borderColor: c.border,
                borderWidth: 1,
                borderRadius: 12,
                padding: 14,
                marginBottom: 10,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.text, fontWeight: '600' }}>{item.requestNumber}</Text>
                <View
                  style={{
                    backgroundColor: tone.bg,
                    borderRadius: 999,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={{ color: tone.fg, fontSize: 12 }}>
                    {REQUEST_STATUS_TOKENS[item.status].label}
                  </Text>
                </View>
              </View>
              <Text style={{ color: c.text, fontSize: 13, marginTop: 6 }} numberOfLines={2}>
                {summary || item.businessReason}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  marginTop: 8,
                }}
              >
                <Text style={{ color: c.muted, fontSize: 12 }}>
                  {personName(item.requester)}
                </Text>
                {item.estimatedCost ? (
                  <Text style={{ color: c.muted, fontSize: 12 }}>
                    {formatMoney(item.estimatedCost, item.currency)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
