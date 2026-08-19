import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiUrl } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Button, Card, Field } from '../src/components/ui';

/**
 * Ask for a password reset link (v2.24), matching the web page of the same name.
 *
 * The link in the email opens the website to finish, because setting the new
 * password ends every session on the account and that is a job for one place,
 * not two. Asking for the link happens here so nobody is thrown out to a
 * browser at the point they are already stuck.
 *
 * The confirmation is identical whether or not the address has an account, the
 * same as the web page and the same as the server, which always answers 202:
 * a screen that says "no such user" is a way to enumerate who works here.
 */
export default function ForgotPasswordScreen() {
  const { c, spacing, scheme } = useTheme();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (email.trim().length === 0) return;
    setBusy(true);
    try {
      await fetch(`${apiUrl}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // Swallowed on purpose: a failure here is either the address not existing
      // or the mail provider being unhappy, and telling those apart is exactly
      // what the endpoint refuses to do.
    }
    setBusy(false);
    setSent(true);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: spacing.xl }}
      >
        <Card level={2} style={{ padding: 22 }}>
          <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
            <Image
              source={
                scheme === 'dark'
                  ? require('../assets/wordmark-dark.png')
                  : require('../assets/wordmark.png')
              }
              style={{ width: 180, height: 33 }}
              resizeMode="contain"
              accessibilityLabel="PioAssets"
            />
            <Text
              style={{ color: c.text, fontSize: 20, fontWeight: '700', marginTop: spacing.lg }}
            >
              {sent ? 'Check your email' : 'Forgot your password?'}
            </Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 4, textAlign: 'center' }}>
              {sent
                ? 'If that address has a PioAssets account, a reset link is on its way.'
                : 'Enter your work email and we will send you a link to set a new password.'}
            </Text>
          </View>

          {sent ? (
            <View style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Ionicons name="mail-outline" size={16} color={c.brand} style={{ marginTop: 1 }} />
                <Text style={{ color: c.muted, fontSize: 13, flex: 1 }}>
                  The link is valid for 30 minutes and can be used once. Open it on this phone and
                  it will finish in your browser.
                </Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 13 }}>
                Nothing arrived? Check your spam folder, then ask an administrator — some mail
                systems quarantine automated messages.
              </Text>
            </View>
          ) : (
            <>
              <Field
                label="Work email"
                placeholder="you@company.com"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                autoFocus
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={onSubmit}
                returnKeyType="send"
              />
              <Button label="Send reset link" onPress={onSubmit} loading={busy} />
            </>
          )}
        </Card>

        <Link href="/login" asChild>
          <Pressable style={{ marginTop: spacing.xl, alignSelf: 'center' }} hitSlop={8}>
            <Text style={{ color: c.brand, fontSize: 14, fontWeight: '600' }}>Back to sign in</Text>
          </Pressable>
        </Link>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
