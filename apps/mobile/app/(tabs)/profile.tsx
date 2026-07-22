import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, useColorScheme, View } from 'react-native';
import { useSession } from '../../src/providers/session';
import { colors } from '../../src/theme';

/**
 * Profile: identity, push registration, and sign-out.
 *
 * Registering for push asks the OS for permission, gets the Expo token, and posts
 * it to the mobile-sync device endpoint. Server-side that token is deduplicated,
 * so re-registering on every launch is safe.
 */
export default function ProfileScreen() {
  const { user, api, logout } = useSession();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];
  const [pushState, setPushState] = useState<'idle' | 'registered' | 'denied'>('idle');

  // Register once on mount. registerForPush closes over `api`, which is stable
  // for the session's lifetime, so an empty dependency list is correct here.
  useEffect(() => {
    void registerForPush();
  }, []);

  async function registerForPush() {
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    if (!granted) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) {
      setPushState('denied');
      return;
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await api.request('/mobile/devices', {
      method: 'POST',
      body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    });
    setPushState('registered');
  }

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  if (!user) return null;

  return (
    <View style={{ flex: 1, backgroundColor: c.background, padding: 24 }}>
      <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>
        {user.displayName ?? user.email}
      </Text>
      <Text style={{ color: c.muted, marginTop: 4 }}>{user.email}</Text>
      <Text style={{ color: c.muted, marginTop: 2 }}>{user.roleNames.join(', ')}</Text>
      {user.departmentName ? (
        <Text style={{ color: c.muted, marginTop: 2 }}>
          {user.departmentName}
          {user.officeName ? ` · ${user.officeName}` : ''}
        </Text>
      ) : null}

      <View
        style={{
          marginTop: 24,
          padding: 12,
          borderRadius: 10,
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: c.border,
        }}
      >
        <Text style={{ color: c.text }}>
          Push notifications:{' '}
          {pushState === 'registered'
            ? 'on'
            : pushState === 'denied'
              ? 'blocked in settings'
              : 'setting up…'}
        </Text>
      </View>

      <Pressable
        onPress={onLogout}
        style={{
          marginTop: 'auto',
          borderRadius: 10,
          padding: 14,
          borderWidth: 1,
          borderColor: '#ef4444',
        }}
      >
        <Text style={{ color: '#ef4444', textAlign: 'center', fontWeight: '600' }}>Sign out</Text>
      </Pressable>
    </View>
  );
}
