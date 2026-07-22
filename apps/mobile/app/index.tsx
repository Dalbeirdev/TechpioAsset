import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../src/providers/session';

/**
 * Entry gate: routes to the app, the biometric-unlock screen, or login depending
 * on session state.
 */
export default function Index() {
  const { status } = useSession();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (status === 'authenticated') return <Redirect href="/(tabs)" />;
  // 'locked' and 'anonymous' both go to login, which offers biometric unlock when
  // a stored session exists.
  return <Redirect href="/login" />;
}
