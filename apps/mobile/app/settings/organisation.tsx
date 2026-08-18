import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, Field, Screen, SectionTitle } from '../../src/components/ui';

/**
 * Company settings.
 *
 * Includes who may raise a request, because that is a decision someone makes in
 * response to something happening - a flood of duplicate requests, a new joiner
 * cohort - rather than at a desk. It is the same field the web page writes, and
 * the server is the only thing that enforces it.
 *
 * Locale and legal name are read-only here: they are set once at onboarding and
 * a phone is not where anyone revisits them.
 */

type RequestPolicy = 'EVERYONE' | 'ADMINS_ONLY';

interface Company {
  name: string;
  legalName: string | null;
  baseCurrency: string;
  timezone: string;
  locale: string | null;
  requestPolicy: RequestPolicy;
}

const POLICIES: { value: RequestPolicy; label: string; detail: string }[] = [
  {
    value: 'EVERYONE',
    label: 'Everyone',
    detail: 'Any employee can raise their own request.',
  },
  {
    value: 'ADMINS_ONLY',
    label: 'IT and HR only',
    detail: 'Employees ask IT or HR, who raise it on their behalf.',
  },
];

export default function OrganisationSettingsScreen() {
  const { api } = useSession();
  const { c, spacing } = useTheme();

  const [company, setCompany] = useState<Company | null>(null);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const [timezone, setTimezone] = useState('');
  const [policy, setPolicy] = useState<RequestPolicy>('EVERYONE');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.request<Company>('/company');
      setCompany(data);
      setName(data.name);
      setCurrency(data.baseCurrency);
      setTimezone(data.timezone);
      setPolicy(data.requestPolicy);
    } catch {
      setError('Could not load company settings.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => void load(), [load]);

  const dirty =
    company !== null &&
    (name !== company.name ||
      currency !== company.baseCurrency ||
      timezone !== company.timezone ||
      policy !== company.requestPolicy);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.request('/company', {
        method: 'PATCH',
        body: {
          name: name.trim(),
          baseCurrency: currency.trim().toUpperCase(),
          timezone: timezone.trim(),
          requestPolicy: policy,
        },
      });
      setSaved(true);
      await load();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <SectionTitle>Company</SectionTitle>
      <Field label="Name" value={name} onChangeText={setName} />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Base currency"
            value={currency}
            onChangeText={setCurrency}
            autoCapitalize="characters"
            maxLength={3}
          />
        </View>
        <View style={{ flex: 2 }}>
          <Field label="Timezone" value={timezone} onChangeText={setTimezone} autoCapitalize="none" />
        </View>
      </View>
      <Text style={{ color: c.subtle, fontSize: 12, marginBottom: spacing.xl, lineHeight: 18 }}>
        Currency labels money going forward. Figures already recorded are not converted.
      </Text>

      <SectionTitle>Who can raise a request</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.lg }}>
        {POLICIES.map((p, i) => {
          const active = policy === p.value;
          return (
            <Pressable
              key={p.value}
              onPress={() => setPolicy(p.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderBottomWidth: i === POLICIES.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
              }}
            >
              <Ionicons
                name={active ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={active ? c.brand : c.muted}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{p.label}</Text>
                <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>{p.detail}</Text>
              </View>
            </Pressable>
          );
        })}
      </Card>
      <Text style={{ color: c.subtle, fontSize: 12, marginBottom: spacing.xl, lineHeight: 18 }}>
        Individual people can still be allowed or blocked one by one, in the web app.
      </Text>

      {error ? (
        <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text>
      ) : null}
      {saved && !dirty ? (
        <Text style={{ color: c.brand, fontSize: 13, marginBottom: spacing.md }}>Saved.</Text>
      ) : null}

      <Button label="Save changes" onPress={save} loading={busy} disabled={!dirty} />

      {company?.legalName || company?.locale ? (
        <Text style={{ color: c.subtle, fontSize: 12, marginTop: spacing.xl, lineHeight: 18 }}>
          {[company.legalName ? `Legal name: ${company.legalName}` : null,
            company.locale ? `Locale: ${company.locale}` : null]
            .filter(Boolean)
            .join(' · ')}
          {' — set in the web app.'}
        </Text>
      ) : null}
    </Screen>
  );
}
