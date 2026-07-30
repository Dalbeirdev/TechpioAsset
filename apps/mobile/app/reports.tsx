import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { REQUEST_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import type { AssetStatus, RequestStatus } from '@techpioasset/domain';
import { useSession } from '../src/providers/session';
import { useTheme, statusLabel } from '../src/theme';
import { Card, Screen, SectionTitle, StatCard } from '../src/components/ui';

export default function ReportsScreen() {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [assets, setAssets] = useState<{ status: AssetStatus }[]>([]);
  const [requests, setRequests] = useState<{ status: RequestStatus }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, r] = await Promise.all([
        api.request<{ status: AssetStatus }[]>('/assets?pageSize=500').catch(() => []),
        api.request<{ status: RequestStatus }[]>('/requests?pageSize=500').catch(() => []),
      ]);
      setAssets(a ?? []);
      setRequests(r ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const tally = <T extends string>(rows: { status: T }[]) => {
    const m = new Map<T, number>();
    for (const row of rows) m.set(row.status, (m.get(row.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl }}>
        <StatCard icon="cube-outline" value={assets.length} label="Total assets" />
        <StatCard icon="document-text-outline" value={requests.length} label="Total requests" />
      </View>

      <SectionTitle>Assets by status</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {tally(assets).map(([status, n], i, arr) => (
          <BreakdownRow key={status} label={statusLabel(status)} count={n} last={i === arr.length - 1} />
        ))}
        {assets.length === 0 ? <Empty /> : null}
      </Card>

      <SectionTitle>Requests by status</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {tally(requests).map(([status, n], i, arr) => (
          <BreakdownRow
            key={status}
            label={REQUEST_STATUS_TOKENS[status]?.label ?? status}
            count={n}
            last={i === arr.length - 1}
          />
        ))}
        {requests.length === 0 ? <Empty /> : null}
      </Card>

      <Text style={{ color: c.subtle, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
        Full CSV and Excel reports can be exported from the web app.
      </Text>
    </Screen>
  );
}

function BreakdownRow({ label, count, last }: { label: string; count: number; last: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <Text style={{ color: c.text, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{count}</Text>
    </View>
  );
}

function Empty() {
  const { c } = useTheme();
  return <Text style={{ color: c.subtle, fontSize: 13, padding: 16 }}>No data yet.</Text>;
}
