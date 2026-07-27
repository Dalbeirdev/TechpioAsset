import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { REQUEST_STATUS_TOKENS, TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import type { RequestStatus } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { colors } from '../../src/theme';
import { personName, formatMoney } from '../../src/lib/format';

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

/**
 * Request detail with approve / reject (spec section 12).
 *
 * The Approve and Reject actions are only shown when the API reports
 * `canDecide` — holding requests:approve is not enough; the server confirms the
 * caller is the approver for the step the request is currently waiting on. Each
 * action is a single POST /requests/:id/decision the API authorises again.
 */
export default function RequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];
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
    // Rejection is consequential and needs a reason; approval may carry an
    // optional note.
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
        decision === 'APPROVED'
          ? 'The request moves to the next step.'
          : 'The requester has been notified.',
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
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 20 }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>
          {request.requestNumber}
        </Text>
        <View
          style={{ backgroundColor: tone.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}
        >
          <Text style={{ color: tone.fg, fontSize: 13 }}>
            {REQUEST_STATUS_TOKENS[request.status].label}
          </Text>
        </View>
      </View>

      <View style={{ marginTop: 18, gap: 6 }}>
        <Row c={c} label="Requested by" value={personName(request.requester)} />
        {request.beneficiary && request.beneficiary.email !== request.requester?.email ? (
          <Row c={c} label="For" value={personName(request.beneficiary)} />
        ) : null}
        <Row c={c} label="Priority" value={request.priority} />
        {request.estimatedCost ? (
          <Row c={c} label="Estimated cost" value={formatMoney(request.estimatedCost, request.currency)} />
        ) : null}
        {request.requiredBy ? (
          <Row c={c} label="Required by" value={new Date(request.requiredBy).toLocaleDateString()} />
        ) : null}
      </View>

      <Section c={c} title="Reason" />
      <Text style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{request.businessReason}</Text>

      <Section c={c} title="Items" />
      {request.items.map((item) => (
        <View
          key={item.id}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            borderBottomWidth: 1,
            borderBottomColor: c.border,
            paddingVertical: 8,
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

      <Section c={c} title="Approval chain" />
      {request.approvals.map((step) => (
        <View
          key={step.id}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}
        >
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              backgroundColor: decisionColor(step.decision, scheme),
            }}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 14 }}>{step.stepName}</Text>
            {step.approver ? (
              <Text style={{ color: c.muted, fontSize: 12 }}>{personName(step.approver)}</Text>
            ) : null}
            {step.comment ? (
              <Text style={{ color: c.muted, fontSize: 12, fontStyle: 'italic' }}>
                “{step.comment}”
              </Text>
            ) : null}
          </View>
          <Text style={{ color: c.muted, fontSize: 12 }}>{decisionLabel(step.decision)}</Text>
        </View>
      ))}

      {request.canDecide ? (
        <View style={{ marginTop: 24 }}>
          <TextInput
            placeholder="Comment (required to reject)"
            placeholderTextColor={c.muted}
            value={comment}
            onChangeText={setComment}
            multiline
            style={{
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: 10,
              padding: 12,
              color: c.text,
              minHeight: 60,
              marginBottom: 12,
            }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={() => void decide('REJECTED')}
              disabled={busy}
              style={{
                flex: 1,
                borderRadius: 10,
                padding: 14,
                borderWidth: 1,
                borderColor: '#ef4444',
              }}
            >
              <Text style={{ color: '#ef4444', textAlign: 'center', fontWeight: '600' }}>
                Reject
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void decide('APPROVED')}
              disabled={busy}
              style={{ flex: 1, borderRadius: 10, padding: 14, backgroundColor: c.brand }}
            >
              {busy ? (
                <ActivityIndicator color={c.brandText} />
              ) : (
                <Text style={{ color: c.brandText, textAlign: 'center', fontWeight: '600' }}>
                  Approve
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Row({ c, label, value }: { c: (typeof colors)['light']; label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: c.muted }}>{label}</Text>
      <Text style={{ color: c.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

function Section({ c, title }: { c: (typeof colors)['light']; title: string }) {
  return (
    <Text
      style={{
        color: c.muted,
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginTop: 22,
        marginBottom: 8,
      }}
    >
      {title}
    </Text>
  );
}

function decisionColor(decision: ApprovalStep['decision'], scheme: 'light' | 'dark'): string {
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  if (decision === 'APPROVED') return palette.success.solid;
  if (decision === 'REJECTED') return palette.critical.solid;
  if (decision === 'PENDING') return palette.warning.solid;
  return palette.muted.solid;
}

function decisionLabel(decision: ApprovalStep['decision']): string {
  return decision.charAt(0) + decision.slice(1).toLowerCase();
}
