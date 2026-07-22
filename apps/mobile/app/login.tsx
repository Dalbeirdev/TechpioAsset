import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, useColorScheme, View } from 'react-native';
import { useSession } from '../src/providers/session';
import { colors } from '../src/theme';

/**
 * Login screen with MFA and biometric unlock.
 *
 * When the device has a stored session (status 'locked'), the screen leads with a
 * biometric unlock button and only falls back to email/password if that fails or
 * the user chooses to sign in as someone else.
 */
export default function LoginScreen() {
  const router = useRouter();
  const { login, unlockWithBiometrics, status } = useSession();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];

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
    <View style={{ flex: 1, backgroundColor: c.background, padding: 24, justifyContent: 'center' }}>
      <Text style={{ color: c.text, fontSize: 26, fontWeight: '700' }}>TechpioAsset</Text>
      <Text style={{ color: c.muted, marginTop: 4, marginBottom: 28 }}>
        Manage Assets. Control Costs. Simplify Operations.
      </Text>

      {status === 'locked' ? (
        <Pressable
          onPress={onBiometric}
          disabled={busy}
          style={{ backgroundColor: c.brand, borderRadius: 10, padding: 16, marginBottom: 16 }}
        >
          <Text style={{ color: c.brandText, textAlign: 'center', fontWeight: '600' }}>
            Unlock with biometrics
          </Text>
        </Pressable>
      ) : null}

      {!needsMfa ? (
        <>
          <TextInput
            placeholder="Email"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            style={inputStyle(c)}
          />
          <TextInput
            placeholder="Password"
            placeholderTextColor={c.muted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={inputStyle(c)}
          />
        </>
      ) : (
        <TextInput
          placeholder="6-digit code"
          placeholderTextColor={c.muted}
          keyboardType="number-pad"
          maxLength={6}
          value={mfaCode}
          onChangeText={setMfaCode}
          style={inputStyle(c)}
        />
      )}

      {error ? <Text style={{ color: '#ef4444', marginBottom: 12 }}>{error}</Text> : null}

      <Pressable
        onPress={onSubmit}
        disabled={busy}
        style={{ backgroundColor: c.brand, borderRadius: 10, padding: 16 }}
      >
        {busy ? (
          <ActivityIndicator color={c.brandText} />
        ) : (
          <Text style={{ color: c.brandText, textAlign: 'center', fontWeight: '600' }}>
            {needsMfa ? 'Verify' : 'Sign in'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function inputStyle(c: (typeof colors)['light']) {
  return {
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    color: c.text,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  };
}
