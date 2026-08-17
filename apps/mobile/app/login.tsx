import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Button, Card, Field } from '../src/components/ui';

/**
 * Login screen with MFA and biometric unlock. When the device has a stored
 * session (status 'locked') it leads with biometric unlock, falling back to
 * email/password.
 */
export default function LoginScreen() {
  const router = useRouter();
  const { login, unlockWithBiometrics, status } = useSession();
  const { c, spacing } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') router.replace('/(tabs)');
  }, [status, router]);

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      const result = await login(email.trim(), password, needsMfa ? mfaCode : undefined);
      if (result === 'mfa-required') setNeedsMfa(true);
    } catch {
      setError('Email or password is incorrect.');
    } finally {
      setBusy(false);
    }
  }

  async function onBiometric() {
    setBusy(true);
    const ok = await unlockWithBiometrics();
    setBusy(false);
    if (!ok) setError('Could not unlock. Sign in with your password.');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: spacing.xl }}
      >
        <View style={{ alignItems: 'center', marginBottom: spacing.xxl }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              backgroundColor: c.brand,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: spacing.lg,
            }}
          >
            <Ionicons name="cube" size={32} color={c.brandText} />
          </View>
          <Text style={{ color: c.text, fontSize: 26, fontWeight: '800' }}>PioAssets</Text>
          <Text style={{ color: c.muted, marginTop: 4, textAlign: 'center' }}>
            Manage Assets. Control Costs. Simplify Operations.
          </Text>
        </View>

        <Card level={2}>
          {status === 'locked' ? (
            <Button
              label="Unlock with biometrics"
              icon="finger-print"
              onPress={onBiometric}
              loading={busy}
              style={{ marginBottom: spacing.md }}
            />
          ) : null}

          {!needsMfa ? (
            <>
              <Field
                label="Email"
                placeholder="you@company.com"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
              />
              <Field
                label="Password"
                placeholder="••••••••"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </>
          ) : (
            <Field
              label="Authentication code"
              placeholder="6-digit code"
              keyboardType="number-pad"
              maxLength={6}
              value={mfaCode}
              onChangeText={setMfaCode}
            />
          )}

          {error ? (
            <Text style={{ color: c.danger, marginBottom: spacing.md, fontSize: 13 }}>{error}</Text>
          ) : null}

          <Button
            label={needsMfa ? 'Verify' : 'Sign in'}
            onPress={onSubmit}
            loading={busy}
          />
        </Card>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            marginTop: spacing.xl,
          }}
        >
          <Ionicons name="shield-checkmark-outline" size={14} color={c.subtle} />
          <Text style={{ color: c.subtle, fontSize: 12 }}>
            Sessions expire automatically and every action is audited.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
