import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Avatar, Card, Chevron, EmptyState, StatusPill } from '../src/components/ui';

interface PersonRow {
  id: string;
  email: string;
  status: string;
  profile: {
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
  } | null;
  roles: { role?: { name?: string } | null; name?: string }[];
}

function displayName(p: PersonRow): string {
  const pr = p.profile;
  if (pr?.displayName) return pr.displayName;
  const joined = [pr?.firstName, pr?.lastName].filter(Boolean).join(' ');
  return joined || p.email;
}

export default function PeopleScreen() {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.request<PersonRow[]>('/users?pageSize=100')) ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.background }}
      data={rows}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
      ListEmptyComponent={loading ? null : <EmptyState icon="people-outline" title="No people yet" />}
      renderItem={({ item }) => {
        const name = displayName(item);
        const role = item.roles?.map((r) => r.role?.name ?? r.name).filter(Boolean)[0];
        const inactive = item.status !== 'ACTIVE';
        return (
          <Card
            onPress={() => router.push(`/person/${item.id}`)}
            style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <Avatar name={name} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                {name}
              </Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {item.profile?.jobTitle ? `${item.profile.jobTitle} · ` : ''}
                {item.email}
              </Text>
            </View>
            {inactive ? (
              <StatusPill label="Inactive" bg={c.dangerSoft} fg={c.danger} />
            ) : role ? (
              <StatusPill label={role} bg={c.brandSoft} fg={c.brand} />
            ) : null}
            <Chevron />
          </Card>
        );
      }}
    />
  );
}
