'use client';

import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { demoRequestSchema, type DemoRequestInput } from '@techpioasset/contracts';
import { apiFetch } from '@/lib/api-client';
import { PhoneField } from './form-fields';
import { fieldCls as inputCls } from '@/components/marketing/form-fields';

/**
 * About-page visuals (2026-08): the "digital asset map" hero and the compact
 * contact form. Deliberately NOT the homepage's dashboard/mascot language -
 * this page reads as information architecture: one asset record at the centre,
 * its meaning radiating outward. Node/edge reveal rides the mkt-pop / mkt-flow
 * classes; reduced-motion shows the finished map.
 */

const NODES: { label: string; x: number; y: number; delay: number }[] = [
  { label: 'Employee', x: 84, y: 60, delay: 0.3 },
  { label: 'Location', x: 356, y: 52, delay: 0.6 },
  { label: 'Purchase', x: 34, y: 172, delay: 0.9 },
  { label: 'Warranty', x: 374, y: 168, delay: 1.2 },
  { label: 'Service', x: 66, y: 292, delay: 1.5 },
  { label: 'Cost', x: 372, y: 296, delay: 1.8 },
  { label: 'Lifecycle', x: 220, y: 344, delay: 2.1 },
];

export function AssetMap() {
  return (
    <div
      role="img"
      aria-label="Diagram: one central asset record connected to the employee, location, purchase, warranty, service, cost and lifecycle information around it"
      className="relative mx-auto w-full max-w-[500px]"
    >
      <svg viewBox="0 0 440 400" className="h-auto w-full overflow-visible">
        {/* connection lines */}
        <g stroke="var(--color-brand)" strokeWidth="1.5" fill="none" opacity="0.45">
          {NODES.map((n) => (
            <line key={n.label} x1="220" y1="196" x2={n.x + 28} y2={n.y + 14} className="mkt-flow" />
          ))}
        </g>

        {/* orbit rings */}
        <circle cx="220" cy="196" r="132" fill="none" stroke="var(--color-border)" strokeDasharray="3 6" />
        <circle cx="220" cy="196" r="182" fill="none" stroke="var(--color-border)" strokeDasharray="2 8" opacity="0.7" />

        {/* central asset record */}
        <g>
          <rect x="150" y="140" width="140" height="112" rx="16" fill="var(--color-surface)" stroke="var(--color-border-strong)" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 10px 24px rgb(29 78 216 / 0.18))' }} />
          <rect x="164" y="156" width="34" height="26" rx="6" fill="var(--color-brand)" opacity="0.14" />
          <path d="M171 176 v-10 a4 4 0 0 1 4 -4 h12 a4 4 0 0 1 4 4 v10" stroke="var(--color-brand)" strokeWidth="2" fill="none" />
          <rect x="168" y="176" width="26" height="3" rx="1.5" fill="var(--color-brand)" />
          <text x="206" y="166" fontSize="10.5" fontWeight="700" fill="var(--color-content)">Asset record</text>
          <text x="206" y="180" fontSize="8.5" fill="var(--color-content-subtle)">PIO-01241</text>
          <g fill="var(--color-content-subtle)" fontSize="8">
            <rect x="164" y="196" width="112" height="5" rx="2.5" fill="var(--color-surface-sunken)" />
            <rect x="164" y="208" width="86" height="5" rx="2.5" fill="var(--color-surface-sunken)" />
            <rect x="164" y="220" width="98" height="5" rx="2.5" fill="var(--color-surface-sunken)" />
          </g>
          <circle cx="278" cy="152" r="5" fill="var(--tone-success-fg)" />
        </g>
      </svg>

      {/* metadata nodes as HTML for crisp text */}
      {NODES.map((n) => (
        <span
          key={n.label}
          className="mkt-pop absolute -translate-x-1/2 whitespace-nowrap rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-content-muted)] shadow-sm"
          style={{ left: `${((n.x + 28) / 440) * 100}%`, top: `${(n.y / 400) * 100}%`, animationDelay: `${n.delay}s` }}
        >
          {n.label}
        </span>
      ))}
    </div>
  );
}

/** The vertical "an asset is more than a serial number" information tree. */
const TREE = [
  ['Ownership', 'Who is responsible for it?'],
  ['Context', 'Where is it used?'],
  ['History', 'What has happened to it?'],
  ['Cost', 'What has it cost the organization?'],
  ['Condition', 'What state is it in?'],
  ['Future', 'When should it be replaced, transferred or retired?'],
] as const;

export function AssetTree() {
  return (
    <div className="relative mx-auto max-w-xl">
      <p className="font-mono text-sm font-semibold tracking-[0.3em] text-[var(--color-brand)]">ASSET</p>
      <div className="mt-2 border-l-2 border-[var(--color-brand)]/30 pl-0">
        {TREE.map(([label, q], i) => (
          <div key={label} className="relative py-4 pl-10" style={{ animationDelay: `${i * 120}ms` }}>
            <span aria-hidden="true" className="absolute left-0 top-1/2 h-px w-7 bg-[var(--color-brand)]/40" />
            <span aria-hidden="true" className="absolute left-7 top-1/2 size-2 -translate-y-1/2 rounded-full bg-[var(--color-brand)]" />
            <p className="text-lg font-semibold tracking-tight">{label}</p>
            <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">{q}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── compact editorial contact form ─────────────────────────────────────── */



export function AboutContactForm() {
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const form = useForm<DemoRequestInput>({
    resolver: zodResolver(demoRequestSchema),
    defaultValues: {
      fullName: '',
      email: '',
      company: '',
      phoneCountry: '+91',
      phone: '',
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
      <div className="flex items-start gap-3 border-l-2 border-[var(--tone-success-fg)] py-2 pl-5">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 flex-none text-[var(--tone-success-fg)]" />
        <div>
          <p className="font-semibold">Message sent</p>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Thanks for writing — we&apos;ll reply from{' '}
            <a href="mailto:dalbeir@techpio.com" className="font-medium text-[var(--color-brand)]">dalbeir@techpio.com</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-3.5">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <label htmlFor="ac-name" className="sr-only">Name</label>
          <input id="ac-name" placeholder="Name" autoComplete="name" className={inputCls} {...form.register('fullName')} />
          {form.formState.errors.fullName ? <p className="mt-1 text-xs text-[var(--tone-critical-fg)]">{form.formState.errors.fullName.message}</p> : null}
        </div>
        <div>
          <label htmlFor="ac-email" className="sr-only">Work email</label>
          <input id="ac-email" type="email" placeholder="Work email" autoComplete="email" className={inputCls} {...form.register('email')} />
          {form.formState.errors.email ? <p className="mt-1 text-xs text-[var(--tone-critical-fg)]">{form.formState.errors.email.message}</p> : null}
        </div>
      </div>
      <div>
        <label htmlFor="ac-company" className="sr-only">Company</label>
        <input id="ac-company" placeholder="Company" autoComplete="organization" className={inputCls} {...form.register('company')} />
        {form.formState.errors.company ? <p className="mt-1 text-xs text-[var(--tone-critical-fg)]">{form.formState.errors.company.message}</p> : null}
      </div>
      <Controller
        control={form.control}
        name="phoneCountry"
        render={({ field: codeField }) => (
          <Controller
            control={form.control}
            name="phone"
            render={({ field: numberField }) => (
              <PhoneField
                idBase="ac-phone"
                code={codeField.value ?? '+91'}
                onCodeChange={codeField.onChange}
                number={numberField.value ?? ''}
                onNumberChange={numberField.onChange}
                error={form.formState.errors.phone?.message ?? form.formState.errors.phoneCountry?.message}
              />
            )}
          />
        )}
      />
      <div>
        <label htmlFor="ac-message" className="sr-only">Message</label>
        <textarea id="ac-message" rows={4} placeholder="What are you trying to improve?" className={`${inputCls} h-auto py-2.5`} {...form.register('message')} />
      </div>

      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="ac-website">Website</label>
        <input id="ac-website" tabIndex={-1} autoComplete="off" {...form.register('website')} />
      </div>

      {failed ? (
        <p role="alert" className="text-sm text-[var(--tone-critical-fg)]">
          Sending failed — please email{' '}
          <a className="font-semibold underline" href="mailto:dalbeir@techpio.com">dalbeir@techpio.com</a> directly.
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-6 text-sm font-semibold text-[var(--color-brand-contrast)] transition-colors hover:bg-[var(--color-brand-hover)] disabled:opacity-60"
        >
          {form.formState.isSubmitting ? 'Sending…' : 'Send Message'}
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
      </div>
    </form>
  );
}
