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
 * Bottom tab navigation (spec section 2). Tabs are shown by permission,
 * mirroring the web sidebar; the API enforces each permission regardless.
 */
export default function TabsLayout() {
  const { status, user } = useSession();
  const { c } = useTheme();

  if (status !== 'authenticated' || !user) return <Redirect href="/login" />;

  const can = (permission: string) => user.permissions.includes(permission);

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
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: icon('home-outline') }}
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
          href: can(PERMISSIONS.REQUESTS_APPROVE) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="capture"
        options={{
          title: 'Capture',
          tabBarIcon: icon('receipt-outline'),
          href: can(PERMISSIONS.INVOICES_UPLOAD) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: icon('scan-outline'),
          href: can(PERMISSIONS.ASSETS_READ) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          tabBarIcon: icon('cube-outline'),
          href: can(PERMISSIONS.INVENTORY_ADJUST) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: icon('person-circle-outline') }}
      />
    </Tabs>
  );
}
