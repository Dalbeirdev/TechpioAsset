import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Card, Screen, SectionTitle, StatusPill } from '../../src/components/ui';

/**
 * Where you are signed in, and how you got there.
 *
 * Read-only on purpose. "Sign out everywhere else" is not offered here because
 * the server identifies the caller's own session from the refresh cookie, and a
 * native client has no cookie jar - so from a phone it would revoke every
 * session including this one, which is not what the button says. It stays on
 * the web until the refresh token is readable from a header.
 */

interface Session {
  id: string;
  device: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  createdAt: string;
  current: boolean;
}

interface LoginEvent {
  id: string;
  action: string;
  at: string;
  ipAddress: string | null;
  device: string | null;
}

/** User agents are long and mostly noise; the useful part is the platform. */
function shortDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ios/i.test(ua)) return 'iPhone or iPad';
  if (/windows/i.test(ua)) return 'Windows';
  if (/macintosh|mac os/i.test(ua)) return 'Mac';
  if (/linux/i.test(ua)) return 'Linux';
  return ua.slice(0, 40);
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export default function SecuritySettingsScreen() {
  const { api, user } = useSession();
  const { c, spacing } = useTheme();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [history, setHistory] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        api.request<Session[]>('/auth/sessions').catch(() => []),
        api.request<LoginEvent[]>('/auth/login-history').catch(() => []),
      ]);
      setSessions(s ?? []);
      setHistory((h ?? []).slice(0, 15));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => void load(), [load]);

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <SectionTitle>Account</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        <Row label="Signed in as" value={user?.email ?? '—'} />
        <Row
          label="Two-factor"
          value={user?.mfaEnabled ? 'On' : 'Off'}
          tone={user?.mfaEnabled ? 'good' : 'warn'}
          last
        />
      </Card>

      <SectionTitle>{`Signed in on${sessions.length ? ` (${sessions.length})` : ''}`}</SectionTitle>
      {sessions.length === 0 ? (
        <Card style={{ marginBottom: spacing.xl }}>
          <Text style={{ color: c.muted, fontSize: 14 }}>
            {loading ? 'Loading…' : 'No other active sessions.'}
          </Text>
        </Card>
      ) : (
        <Card style={{ padding: 0, marginBottom: spacing.xl }}>
          {sessions.map((s, i) => (
            <View
              key={s.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 13,
                borderBottomWidth: i === sessions.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
              }}
            >
              <Ionicons name="laptop-outline" size={18} color={c.muted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>
                  {shortDevice(s.device)}
                </Text>
                <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {[s.ipAddress, `active ${when(s.lastActiveAt)}`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {s.current ? <StatusPill label="This device" bg={c.brandSoft} fg={c.brand} /> : null}
            </View>
          ))}
        </Card>
      )}

      <SectionTitle>Recent sign-ins</SectionTitle>
      {history.length === 0 ? (
        <Card style={{ marginBottom: spacing.xl }}>
          <Text style={{ color: c.muted, fontSize: 14 }}>
            {loading ? 'Loading…' : 'Nothing recorded yet.'}
          </Text>
        </Card>
      ) : (
        <Card style={{ padding: 0, marginBottom: spacing.xl }}>
          {history.map((h, i) => {
            const failed = /FAIL/i.test(h.action);
            return (
              <View
                key={h.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 13,
                  borderBottomWidth: i === history.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <Ionicons
                  name={failed ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                  size={18}
                  color={failed ? c.danger : c.muted}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: c.text, fontSize: 14 }}>
                    {failed ? 'Failed sign-in' : 'Signed in'}
                  </Text>
                  <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                    {[shortDevice(h.device), h.ipAddress].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={{ color: c.subtle, fontSize: 11 }}>{when(h.at)}</Text>
              </View>
            );
          })}
        </Card>
      )}

      <Text style={{ color: c.subtle, fontSize: 12, lineHeight: 18 }}>
        Signing out of other devices, changing your password and setting up two-factor are in the
        web app.
      </Text>
    </Screen>
  );
}

function Row({
  label,
  value,
  tone,
  last,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn';
  last?: boolean;
}) {
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
      <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
      <Text
        style={{
          color: tone === 'warn' ? c.danger : c.text,
          fontSize: 14,
          fontWeight: '600',
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}
