import { Text, useColorScheme, View } from 'react-native';
import { colors } from '../theme';

/**
 * Placeholder shown on web for features that require a device (camera, secure
 * enclave, etc.). The mobile app runs in a browser via react-native-web for
 * review, but hardware-backed features have no web equivalent — so rather than
 * crash, those screens render this and point the reviewer at the device build.
 */
export function NativeOnlyNotice({ title, message }: { title: string; message: string }) {
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.background,
        padding: 24,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          maxWidth: 360,
          backgroundColor: c.surface,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: 14,
          padding: 20,
        }}
      >
        <Text style={{ color: c.text, fontSize: 17, fontWeight: '600', marginBottom: 8 }}>
          {title}
        </Text>
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>{message}</Text>
        <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginTop: 12 }}>
          Open the app in Expo Go on a phone to use this feature.
        </Text>
      </View>
    </View>
  );
}
