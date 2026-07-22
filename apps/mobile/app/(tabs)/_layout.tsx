import { Tabs } from 'expo-router';
import { Redirect } from 'expo-router';
import { PERMISSIONS } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';

/**
 * Bottom tab navigation (spec section 2: bottom navigation where appropriate).
 *
 * Tabs are shown by permission, mirroring the web sidebar: every employee gets
 * My assets and Requests; the scan and inventory tabs require the asset/inventory
 * permissions an IT or Office admin holds. The API enforces each regardless.
 */
export default function TabsLayout() {
  const { status, user } = useSession();

  if (status !== 'authenticated' || !user) return <Redirect href="/login" />;

  const can = (permission: string) => user.permissions.includes(permission);

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: 'My assets' }} />
      <Tabs.Screen name="requests" options={{ title: 'Requests' }} />
      <Tabs.Screen
        name="scan"
        options={{ title: 'Scan', href: can(PERMISSIONS.ASSETS_READ) ? undefined : null }}
      />
      <Tabs.Screen
        name="inventory"
        options={{ title: 'Inventory', href: can(PERMISSIONS.INVENTORY_ADJUST) ? undefined : null }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
