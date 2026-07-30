import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../src/providers/session';
import { useTheme } from '../src/theme';

/**
 * Root layout. Wraps the whole app in the safe-area + session providers, and
 * themes the native navigation headers to match the app's palette.
 */
export default function RootLayout() {
  const { c } = useTheme();
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShown: false,
            headerStyle: { backgroundColor: c.headerBg },
            headerTintColor: c.text,
            headerTitleStyle: { fontWeight: '700' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: c.background },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="asset/[id]" options={{ headerShown: true, title: 'Asset' }} />
          <Stack.Screen name="request/[id]" options={{ headerShown: true, title: 'Request' }} />
          <Stack.Screen name="scan" options={{ headerShown: true, title: 'Scan' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
