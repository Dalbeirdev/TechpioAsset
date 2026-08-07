'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, Lock, ShieldCheck, ShieldOff } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, Skeleton } from '@/components/ui';

/**
 * The page the profile's "Security settings" button pointed at for two
 * releases without it existing. The MFA endpoints (enrol, confirm, disable)
 * and change-password have been live in the API since v2.x — this is only
 * the missing surface.
 *
 * The enrolment secret is shown once, as text and as an otpauth URI, and never
 * fetched again: refreshing this page after enrolment shows state, not secrets.
 */

const inputCls =
  'h-9 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm';

export default function SecuritySettingsPage() {
  const { user, refresh } = useAuth();
  const toast = useToast();

  // Re-authentication gate: a live session is not proof the account owner is
  // at the keyboard. Held in memory only - leaving the page or refreshing
  // asks again. The server verifies too; this is not a client-only curtain.
  const [confirmed, setConfirmed] = useState(false);
  const [gatePassword, setGatePassword] = useState('');
  const gate = useMutation({
    mutationFn: () =>
      apiFetch('/auth/confirm-password', { method: 'POST', body: { password: gatePassword } }),
    onSuccess: () => {
      setConfirmed(true);
      setGatePassword('');
    },
    onError: () => toast.error('That password is not correct'),
  });

  // MFA enrolment flow state — secret exists only between "start" and "confirm".
  const [enrolment, setEnrolment] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // The QR is drawn locally from the otpauth URI - the secret never goes to any
  // external chart service, which is the only acceptable way to render it.
  useEffect(() => {
    if (!enrolment) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(enrolment.otpauthUrl, { margin: 1, width: 192 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [enrolment]);
  const [confirmCode, setConfirmCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  // Change password state.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordAgain, setNewPasswordAgain] = useState('');

  const start = useMutation({
    mutationFn: () =>
      apiFetch<{ secret: string; otpauthUrl: string }>('/auth/mfa/enrol', { method: 'POST' }),
    onSuccess: setEnrolment,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not start enrolment'),
  });

  const confirm = useMutation({
    mutationFn: () => apiFetch('/auth/mfa/confirm', { method: 'POST', body: { code: confirmCode } }),
    onSuccess: async () => {
      toast.success('Two-factor authentication is on');
      setEnrolment(null);
      setConfirmCode('');
      await refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'That code did not match'),
  });

  const disable = useMutation({
    mutationFn: () =>
      apiFetch('/auth/mfa/disable', {
        method: 'POST',
        body: { password: disablePassword, code: disableCode },
      }),
    onSuccess: async () => {
      toast.success('Two-factor authentication is off');
      setDisablePassword('');
      setDisableCode('');
      await refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not disable'),
  });

  const changePassword = useMutation({
    mutationFn: () =>
      apiFetch('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      }),
    onSuccess: () => {
      toast.success('Password changed');
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordAgain('');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not change password'),
  });

  if (!user) return <Skeleton className="mx-auto h-96 max-w-2xl" />;

  if (!confirmed) {
    return (
      <div className="mx-auto grid max-w-md gap-4 pt-10">
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-[var(--color-brand)]/10">
              <Lock aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
            </span>
            <div>
              <h1 className="text-base font-semibold">Confirm it&apos;s you</h1>
              <p className="text-xs text-[var(--color-content-subtle)]">
                Security settings are locked behind your password.
              </p>
            </div>
          </div>
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (gatePassword) gate.mutate();
            }}
          >
            <input
              aria-label="Your password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={gatePassword}
              onChange={(e) => setGatePassword(e.target.value)}
              placeholder="Your password"
              className={inputCls}
            />
            <Button type="submit" loading={gate.isPending} disabled={!gatePassword}>
              Continue
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  const passwordsMatch = newPassword.length > 0 && newPassword === newPasswordAgain;

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Security</h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          Your password and two-factor authentication.
        </p>
      </header>

      <Card className="p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          {user.mfaEnabled ? (
            <ShieldCheck aria-hidden="true" className="size-4 text-[var(--tone-success-fg)]" />
          ) : (
            <ShieldOff aria-hidden="true" className="size-4 text-[var(--tone-warning-fg)]" />
          )}
          Two-factor authentication
        </h2>
        <p className="text-xs text-[var(--color-content-subtle)]">
          {user.mfaEnabled
            ? 'Enabled. Signing in asks for a 6-digit code from your authenticator app.'
            : 'Off. Anyone with your password can sign in as you.'}
        </p>

        {!user.mfaEnabled && !enrolment ? (
          <Button className="mt-3" loading={start.isPending} onClick={() => start.mutate()}>
            Set up two-factor authentication
          </Button>
        ) : null}

        {enrolment ? (
          <div className="mt-4 grid gap-3">
            <p className="text-sm">
              Add this secret to your authenticator app (Google Authenticator, 1Password, Authy…),
              then enter the 6-digit code it shows.
            </p>
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a data URL, not a remote asset
              <img
                src={qrDataUrl}
                alt="QR code for your authenticator app"
                width={192}
                height={192}
                className="rounded-lg border border-[var(--color-border)] bg-white p-2"
              />
            ) : null}
            <p className="text-xs text-[var(--color-content-subtle)]">
              Can&apos;t scan? Enter this setup key manually:
            </p>
            <code className="w-fit rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm tracking-wider">
              {enrolment.secret}
            </code>
            <div className="flex items-center gap-2">
              <input
                aria-label="6-digit code"
                inputMode="numeric"
                maxLength={6}
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className={`${inputCls} w-32 text-center tracking-[0.3em]`}
              />
              <Button
                loading={confirm.isPending}
                disabled={confirmCode.length !== 6}
                onClick={() => confirm.mutate()}
              >
                Turn on
              </Button>
              <Button variant="secondary" onClick={() => { setEnrolment(null); setConfirmCode(''); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {user.mfaEnabled ? (
          <div className="mt-4 grid gap-2">
            <p className="text-xs text-[var(--color-content-subtle)]">
              Turning it off needs your password and a current code — so a walk-away laptop is not
              enough to remove it.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Current password"
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="Password"
                className={`${inputCls} max-w-48`}
              />
              <input
                aria-label="6-digit code"
                inputMode="numeric"
                maxLength={6}
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className={`${inputCls} w-32 text-center tracking-[0.3em]`}
              />
              <Button
                variant="danger"
                loading={disable.isPending}
                disabled={!disablePassword || disableCode.length !== 6}
                onClick={() => disable.mutate()}
              >
                Turn off
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <KeyRound aria-hidden="true" className="size-4 text-[var(--color-brand)]" /> Change password
        </h2>
        <div className="mt-3 grid max-w-sm gap-2">
          <input
            aria-label="Current password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            className={inputCls}
          />
          <input
            aria-label="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            className={inputCls}
          />
          <input
            aria-label="Repeat new password"
            type="password"
            value={newPasswordAgain}
            onChange={(e) => setNewPasswordAgain(e.target.value)}
            placeholder="New password again"
            className={inputCls}
          />
          {newPasswordAgain.length > 0 && !passwordsMatch ? (
            <p className="text-xs" style={{ color: 'var(--tone-critical-fg)' }}>
              The two passwords do not match.
            </p>
          ) : null}
          <div>
            <Button
              loading={changePassword.isPending}
              disabled={!currentPassword || !passwordsMatch}
              onClick={() => changePassword.mutate()}
            >
              Change password
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
