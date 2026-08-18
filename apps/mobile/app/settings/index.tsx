import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { PERMISSIONS } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Card, Screen, SectionTitle } from '../../src/components/ui';

/**
 * Settings, for the phone.
 *
 * Deliberately not every settings page the web app has. Roles is a grid of
 * sixty permissions, integrations hands out API tokens and webhook secrets, and
 * notification templates are a body of copy with a live preview - all of them
 * are worse on a 375px screen than on the laptop they were designed for, and
 * shipping cramped versions would only invite people to do that work here.
 * What is here is what someone genuinely reaches for away from a desk.
 */

interface Row {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  href: string;
  perm?: string;
}

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: 'This device',
    rows: [
      {
        icon: 'color-palette-outline',
        label: 'Appearance',
        detail: 'Light, dark, or follow the phone.',
        href: '/settings/appearance',
      },
      {
        icon: 'shield-checkmark-outline',
        label: 'Security',
        detail: 'Where you are signed in, and recent sign-ins.',
        href: '/settings/security',
      },
    ],
  },
  {
    title: 'Company',
    rows: [
      {
        icon: 'business-outline',
        label: 'Organisation',
        detail: 'Company name and details.',
        href: '/settings/organisation',
        perm: PERMISSIONS.SETTINGS_MANAGE,
      },
      {
        icon: 'location-outline',
        label: 'Offices',
        detail: 'Sites equipment can belong to.',
        href: '/settings/offices',
        perm: PERMISSIONS.SETTINGS_MANAGE,
      },
      {
        icon: 'people-circle-outline',
        label: 'Departments',
        detail: 'Teams people belong to.',
        href: '/settings/departments',
        perm: PERMISSIONS.SETTINGS_MANAGE,
      },
      {
        icon: 'sparkles-outline',
        label: 'AI settings',
        detail: 'Document processing and review rules.',
        href: '/settings/ai',
        perm: PERMISSIONS.AI_CONFIGURE,
      },
    ],
  },
];

export default function SettingsHubScreen() {
  const { user } = useSession();
  const { c, spacing } = useTheme();
  const router = useRouter();
  const can = (p?: string) => !p || (user?.permissions.includes(p) ?? false);

  return (
    <Screen scroll>
      {GROUPS.map((group) => {
        const rows = group.rows.filter((r) => can(r.perm));
        if (rows.length === 0) return null;
        return (
          <View key={group.title}>
            <SectionTitle>{group.title}</SectionTitle>
            <Card style={{ padding: 0, marginBottom: spacing.xl }}>
              {rows.map((r, i) => (
                <Pressable
                  key={r.href}
                  onPress={() => router.push(r.href as never)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                    borderBottomColor: c.border,
                  }}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      backgroundColor: c.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name={r.icon} size={17} color={c.muted} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{r.label}</Text>
                    <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>{r.detail}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.subtle} />
                </Pressable>
              ))}
            </Card>
          </View>
        );
      })}

      <Text style={{ color: c.subtle, fontSize: 12, lineHeight: 18, textAlign: 'center' }}>
        Roles, integrations, notification templates and scheduled reports are managed in the web
        app, where there is room for them.
      </Text>
    </Screen>
  );
}
