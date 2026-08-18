import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { useAppearance, type Appearance } from '../../src/providers/appearance';
import { useTheme } from '../../src/theme';
import { Card, Screen, SectionTitle } from '../../src/components/ui';

/** Theme choice. Saved on this device, not on the account - the same wording the web page uses. */

const OPTIONS: { value: Appearance; label: string; detail: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'light', label: 'Light', detail: 'Bright surfaces, dark text.', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', detail: 'Dark surfaces, easier at night.', icon: 'moon-outline' },
  {
    value: 'system',
    label: 'System',
    detail: 'Follow this phone’s setting, switching automatically.',
    icon: 'phone-portrait-outline',
  },
];

export default function AppearanceSettingsScreen() {
  const { preference, setPreference } = useAppearance();
  const { c, spacing, scheme } = useTheme();

  return (
    <Screen scroll>
      <SectionTitle>Colour theme</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.lg }}>
        {OPTIONS.map((o, i) => {
          const active = preference === o.value;
          return (
            <Pressable
              key={o.value}
              onPress={() => setPreference(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderBottomWidth: i === OPTIONS.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
              }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  backgroundColor: active ? c.brand : c.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={o.icon} size={17} color={active ? c.brandText : c.muted} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{o.label}</Text>
                <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>{o.detail}</Text>
              </View>
              {active ? <Ionicons name="checkmark-circle" size={20} color={c.brand} /> : null}
            </Pressable>
          );
        })}
      </Card>

      <Text style={{ color: c.subtle, fontSize: 12, lineHeight: 18 }}>
        Saved on this device, not on your account — your laptop keeps its own setting. Currently
        showing the {scheme} theme.
      </Text>
    </Screen>
  );
}
