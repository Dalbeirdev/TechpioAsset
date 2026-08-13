'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, CheckCircle2, Mail } from 'lucide-react';
import { demoRequestSchema, type DemoRequestInput } from '@techpioasset/contracts';
import { apiFetch } from '@/lib/api-client';

/**
 * Lead form for pioassets.com. Validates with the same zod schema the API
 * enforces and posts to /marketing/demo-request, which relays to
 * dalbeir@techpio.com. The hidden `website` field is the bot honeypot.
 */

const ASSET_OPTIONS = [
  ['UNDER_100', 'Under 100'],
  ['FROM_100_TO_500', '100–500'],
  ['FROM_500_TO_1000', '500–1,000'],
  ['OVER_1000', '1,000+'],
] as const;

const INTEREST_OPTIONS = [
  ['ASSET_MANAGEMENT', 'Asset Management'],
  ['HARDWARE_TRACKING', 'Hardware Tracking'],
  ['WARRANTY_MANAGEMENT', 'Warranty Management'],
  ['SOFTWARE_LICENSES', 'Software & License Management'],
  ['IT_INVENTORY', 'IT Inventory'],
  ['OTHER', 'Other'],
] as const;

const inputCls =
  'h-11 w-full rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3.5 text-sm outline-none transition-colors focus:border-[var(--color-brand)]';
const labelCls = 'text-sm font-medium';
const errCls = 'mt-1 text-xs text-[var(--tone-critical-fg)]';

export function DemoForm() {
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const form = useForm<DemoRequestInput>({
    resolver: zodResolver(demoRequestSchema),
    defaultValues: {
      fullName: '',
      email: '',
      company: '',
      phone: '',
      assetCount: 'UNDER_100',
      interest: 'ASSET_MANAGEMENT',
      message: '',
      website: '',
    },
  });

  async function onSubmit(values: DemoRequestInput) {
    setFailed(false);
    try {
      await apiFetch('/marketing/demo-request', { method: 'POST', body: values });
      setSent(true);
    } catch {
      setFailed(true);
    }
  }

  if (sent) {
    return (
      <div className="grid place-items-center gap-3 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center shadow-sm">
        <CheckCircle2 aria-hidden="true" className="size-10 text-[var(--tone-success-fg)]" />
        <h3 className="text-lg font-semibold">Request received</h3>
        <p className="max-w-sm text-sm text-[var(--color-content-muted)]">
          Thanks — we&apos;ll get back to you shortly to arrange a walkthrough. If it&apos;s urgent,
          write to us directly at{' '}
          <a className="font-medium text-[var(--color-brand)]" href="mailto:dalbeir@techpio.com">
            dalbeir@techpio.com
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      className="grid gap-4 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm sm:p-8"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="df-name" className={labelCls}>Full name</label>
          <input id="df-name" autoComplete="name" className={`${inputCls} mt-1.5`} {...form.register('fullName')} />
          {form.formState.errors.fullName ? <p className={errCls}>{form.formState.errors.fullName.message}</p> : null}
        </div>
        <div>
          <label htmlFor="df-email" className={labelCls}>Business email</label>
          <input id="df-email" type="email" autoComplete="email" className={`${inputCls} mt-1.5`} {...form.register('email')} />
          {form.formState.errors.email ? <p className={errCls}>{form.formState.errors.email.message}</p> : null}
        </div>
        <div>
          <label htmlFor="df-company" className={labelCls}>Company name</label>
          <input id="df-company" autoComplete="organization" className={`${inputCls} mt-1.5`} {...form.register('company')} />
          {form.formState.errors.company ? <p className={errCls}>{form.formState.errors.company.message}</p> : null}
        </div>
        <div>
          <label htmlFor="df-phone" className={labelCls}>Phone number <span className="text-[var(--color-content-subtle)]">(optional)</span></label>
          <input id="df-phone" type="tel" autoComplete="tel" className={`${inputCls} mt-1.5`} {...form.register('phone')} />
        </div>
        <div>
          <label htmlFor="df-assets" className={labelCls}>Number of assets</label>
          <select id="df-assets" className={`${inputCls} mt-1.5`} {...form.register('assetCount')}>
            {ASSET_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="df-interest" className={labelCls}>What do you need help with?</label>
          <select id="df-interest" className={`${inputCls} mt-1.5`} {...form.register('interest')}>
            {INTEREST_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="df-message" className={labelCls}>Message <span className="text-[var(--color-content-subtle)]">(optional)</span></label>
        <textarea id="df-message" rows={4} className={`${inputCls} mt-1.5 h-auto py-2.5`} {...form.register('message')} />
      </div>

      {/* Honeypot: visually hidden, never announced; humans skip it, bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="df-website">Website</label>
        <input id="df-website" tabIndex={-1} autoComplete="off" {...form.register('website')} />
      </div>

      {failed ? (
        <p role="alert" className="rounded-xl border border-[var(--tone-critical-border)] bg-[var(--tone-critical-bg)] px-3.5 py-2.5 text-sm text-[var(--tone-critical-fg)]">
          Something went wrong sending the request. Please email us directly at{' '}
          <a className="font-semibold underline" href="mailto:dalbeir@techpio.com">dalbeir@techpio.com</a>.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-[var(--color-brand)] px-7 text-sm font-semibold text-[var(--color-brand-contrast)] transition-colors hover:bg-[var(--color-brand-hover)] disabled:opacity-60"
        >
          {form.formState.isSubmitting ? 'Sending…' : 'Request a Demo'}
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
        <a href="mailto:dalbeir@techpio.com" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-content-muted)] hover:text-[var(--color-brand)]">
          <Mail aria-hidden="true" className="size-4" /> dalbeir@techpio.com
        </a>
      </div>
    </form>
  );
}
