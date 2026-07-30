import { Ionicons } from '@expo/vector-icons';
import { Tabs, Redirect } from 'expo-router';
import type { ComponentProps } from 'react';
import { PERMISSIONS } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon =
  (name: IconName) =>
  ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );

/**
 * Bottom tab navigation. Five core tabs stay on the bar; everything else lives
 * under "More" (hidden tab screens, reached from the More menu). Tabs are shown
 * by permission, mirroring the web sidebar; the API enforces each regardless.
 */
export default function TabsLayout() {
  const { status, user } = useSession();
  const { c } = useTheme();

  if (status !== 'authenticated' || !user) return <Redirect href="/login" />;

  const can = (permission: string) => user.permissions.includes(permission);
  const gate = (permission: string) => (can(permission) ? undefined : null);

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: c.headerBg },
        headerTintColor: c.text,
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: c.tabBar,
          borderTopColor: c.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarActiveTintColor: c.tabActive,
        tabBarInactiveTintColor: c.tabInactive,
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen
        name="assets"
        options={{ title: 'Assets', tabBarIcon: icon('cube-outline'), href: gate(PERMISSIONS.ASSETS_READ) }}
      />
      <Tabs.Screen
        name="requests"
        options={{ title: 'Requests', tabBarIcon: icon('document-text-outline') }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: 'Approvals',
          tabBarIcon: icon('checkmark-done-outline'),
          href: gate(PERMISSIONS.REQUESTS_APPROVE),
        }}
      />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('grid-outline') }} />

      {/* Reached from the More menu — hidden from the bar. */}
      <Tabs.Screen name="capture" options={{ title: 'Capture bill', href: null }} />
      <Tabs.Screen name="scan" options={{ title: 'Scan', href: null }} />
      <Tabs.Screen name="inventory" options={{ title: 'Inventory', href: null }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', href: null }} />
    </Tabs>
  );
}
