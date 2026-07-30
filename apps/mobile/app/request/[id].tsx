import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import {
  REQUEST_STATUS_TOKENS,
  TONE_PALETTE_DARK,
  TONE_PALETTE_LIGHT,
} from '@techpioasset/ui-tokens';
import type { RequestStatus } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme, type Scheme } from '../../src/theme';
import { personName, formatMoney } from '../../src/lib/format';
import { Button, Card, Field, Screen, SectionTitle, StatusPill } from '../../src/components/ui';

interface ApprovalStep {
  id: string;
  stepName: string;
  decision: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
  comment: string | null;
  approver: {
    email: string;
    profile: { firstName: string | null; lastName: string | null } | null;
  } | null;
}

interface RequestDetail {
  id: string;
  requestNumber: string;
  type: string;
  status: RequestStatus;
  priority: string;
  businessReason: string;
  requiredBy: string | null;
  estimatedCost: string | null;
  currency: string;
  requester: {
    email: string;
    profile: { firstName: string | null; lastName: string | null } | null;
  } | null;
  beneficiary: {
    email: string;
    profile: { firstName: string | null; lastName: string | null } | null;
  } | null;
  items: { id: string; description: string; quantity: number; estimatedCost: string | null }[];
  approvals: ApprovalStep[];
  canDecide: boolean;
}

/** Request detail with approve / reject (spec section 12). */
export default function RequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api.request<RequestDetail>(`/requests/${id}`);
    setRequest(data);
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    if (!request) return;
    if (decision === 'REJECTED' && comment.trim().length === 0) {
      Alert.alert('Add a reason', 'Please note why you are rejecting this request.');
      return;
    }
    setBusy(true);
    try {
      await api.request(`/requests/${request.id}/decision`, {
        method: 'POST',
        body: { decision, comment: comment.trim() || undefined },
      });
      Alert.alert(
        decision === 'APPROVED' ? 'Approved' : 'Rejected',
        decision === 'APPROVED' ? 'The request moves to the next step.' : 'The requester has been notified.',
      );
      router.back();
    } catch {
      Alert.alert('Could not submit', 'You may no longer be the approver for this step.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!request) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const tone = palette[REQUEST_STATUS_TOKENS[request.status].tone];

  return (
    <Screen scroll>
      <Card style={{ marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>{request.requestNumber}</Text>
          <StatusPill label={REQUEST_STATUS_TOKENS[request.status].label} bg={tone.bg} fg={tone.fg} />
        </View>
        <View style={{ marginTop: spacing.md, gap: 8 }}>
          <Row label="Requested by" value={personName(request.requester)} />
          {request.beneficiary && request.beneficiary.email !== request.requester?.email ? (
            <Row label="For" value={personName(request.beneficiary)} />
          ) : null}
          <Row label="Priority" value={request.priority} />
          {request.estimatedCost ? (
            <Row label="Estimated cost" value={formatMoney(request.estimatedCost, request.currency)} />
          ) : null}
          {request.requiredBy ? (
            <Row label="Required by" value={new Date(request.requiredBy).toLocaleDateString()} />
          ) : null}
        </View>
      </Card>

      <SectionTitle>Reason</SectionTitle>
      <Card style={{ marginBottom: spacing.xl }}>
        <Text style={{ color: c.text, fontSize: 14, lineHeight: 21 }}>{request.businessReason}</Text>
      </Card>

      <SectionTitle>Items</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {request.items.map((item, i) => (
          <View
            key={item.id}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingVertical: 14,
              borderBottomWidth: i === request.items.length - 1 ? 0 : 1,
              borderBottomColor: c.border,
            }}
          >
            <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>
              {item.quantity > 1 ? `${item.quantity}× ` : ''}
              {item.description}
            </Text>
            {item.estimatedCost ? (
              <Text style={{ color: c.muted, fontSize: 13 }}>
                {formatMoney(item.estimatedCost, request.currency)}
              </Text>
            ) : null}
          </View>
        ))}
      </Card>

      <SectionTitle>Approval chain</SectionTitle>
      <Card style={{ marginBottom: spacing.xl }}>
        {request.approvals.map((step, i) => (
          <View
            key={step.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 10,
              borderBottomWidth: i === request.approvals.length - 1 ? 0 : 1,
              borderBottomColor: c.border,
            }}
          >
            <View
              style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: decisionColor(step.decision, scheme) }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{step.stepName}</Text>
              {step.approver ? (
                <Text style={{ color: c.muted, fontSize: 12 }}>{personName(step.approver)}</Text>
              ) : null}
              {step.comment ? (
                <Text style={{ color: c.muted, fontSize: 12, fontStyle: 'italic' }}>“{step.comment}”</Text>
              ) : null}
            </View>
            <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>{decisionLabel(step.decision)}</Text>
          </View>
        ))}
      </Card>

      {request.canDecide ? (
        <Card>
          <Field
            label="Comment (required to reject)"
            placeholder="Add a note…"
            value={comment}
            onChangeText={setComment}
            multiline
          />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button label="Reject" variant="danger" onPress={() => void decide('REJECTED')} disabled={busy} style={{ flex: 1 }} />
            <Button label="Approve" icon="checkmark" onPress={() => void decide('APPROVED')} loading={busy} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: c.muted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: c.text, fontWeight: '600', flexShrink: 1, textAlign: 'right', fontSize: 14 }}>
        {value}
      </Text>
    </View>
  );
}

function decisionColor(decision: ApprovalStep['decision'], scheme: Scheme): string {
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  if (decision === 'APPROVED') return palette.success.solid;
  if (decision === 'REJECTED') return palette.critical.solid;
  if (decision === 'PENDING') return palette.warning.solid;
  return palette.muted.solid;
}

function decisionLabel(decision: ApprovalStep['decision']): string {
  return decision.charAt(0) + decision.slice(1).toLowerCase();
}
