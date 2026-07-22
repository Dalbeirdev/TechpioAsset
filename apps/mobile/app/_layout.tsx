import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../src/providers/session';

/**
 * Root layout. Wraps the whole app in the session provider so every screen can
 * read the current user and the shared API client.
 */
export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="asset/[id]" options={{ headerShown: true, title: 'Asset' }} />
        <Stack.Screen name="scan" options={{ headerShown: true, title: 'Scan' }} />
      </Stack>
    </SessionProvider>
  );
}
