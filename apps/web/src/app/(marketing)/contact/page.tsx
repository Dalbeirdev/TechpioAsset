'use client';

import { useState } from 'react';
import { Clock, Mail, MapPin, Send } from 'lucide-react';
import { HeroAccent, HeroBackdrop, HeroBadge } from '@/components/marketing/hero-backdrop';

const CONTACT_EMAIL = 'proapps@techpio.com';

/**
 * Contact form. With no public inbox endpoint, submitting composes a pre-filled
 * email in the visitor's own mail client — honest and functional, never a fake
 * "message sent". The address is shown plainly too, for anyone who prefers it.
 */
export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || message.trim().length < 10) {
      setError('Add your name, a valid email, and a message of at least 10 characters.');
      return;
    }
    setError(null);
    const subject = `PioAssets enquiry from ${name.trim()}`;
    const body = [
      `Name: ${name.trim()}`,
      `Email: ${email.trim()}`,
      company.trim() ? `Company: ${company.trim()}` : null,
      '',
      message.trim(),
    ]
      .filter((l) => l !== null)
      .join('\n');
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setOpened(true);
  }

  return (
    <>
    <section className="relative overflow-hidden">
      <HeroBackdrop />
      <div className="relative mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <div className="max-w-2xl">
          <HeroBadge>Contact</HeroBadge>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl">
            Let’s talk about your <HeroAccent>asset register.</HeroAccent>
          </h1>
          <p className="mt-5 text-lg text-white/80">
            Questions, a walkthrough, or help importing your existing data — tell us what you need
            and we’ll get back to you.
          </p>
        </div>
      </div>
    </section>
    <section className="mx-auto max-w-6xl px-5 py-14">
      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
        {/* Form */}
        <form onSubmit={submit} noValidate className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
                placeholder="Your name"
                autoComplete="name"
              />
            </Field>
            <Field label="Work email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="you@company.com"
                autoComplete="email"
              />
            </Field>
          </div>
          <Field label="Company" optional>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className={inputCls}
              placeholder="Company name"
              autoComplete="organization"
            />
          </Field>
          <Field label="How can we help?">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              className={`${inputCls} resize-y`}
              placeholder="Tell us a little about your team and what you’re tracking today…"
            />
          </Field>

          {error ? (
            <p
              role="alert"
              className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
              style={{
                color: 'var(--tone-critical-fg)',
                backgroundColor: 'var(--tone-critical-bg)',
                borderColor: 'var(--tone-critical-border)',
              }}
            >
              {error}
            </p>
          ) : null}

          {opened ? (
            <p
              role="status"
              className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
              style={{
                color: 'var(--tone-success-fg)',
                backgroundColor: 'var(--tone-success-bg)',
                borderColor: 'var(--tone-success-border)',
              }}
            >
              Your email app should have opened with the message ready to send. If it didn’t, email
              us directly at {CONTACT_EMAIL}.
            </p>
          ) : null}

          <div>
            <button
              type="submit"
              className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]"
            >
              <Send aria-hidden="true" className="size-4" />
              Send message
            </button>
          </div>
        </form>

        {/* Contact details */}
        <aside className="grid content-start gap-4">
          <InfoCard
            Icon={Mail}
            title="Email us"
            lines={[CONTACT_EMAIL]}
            href={`mailto:${CONTACT_EMAIL}`}
          />
          <InfoCard
            Icon={Clock}
            title="Response time"
            lines={['We usually reply within 1–2 business days.']}
          />
          <InfoCard Icon={MapPin} title="Company" lines={['TechPio Services LLP']} />
        </aside>
      </div>
    </section>
    </>
  );
}

const inputCls =
  'h-11 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-content)] placeholder:text-[var(--color-content-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]';

function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">
        {label}
        {optional ? (
          <span className="ml-1 font-normal text-[var(--color-content-subtle)]">(optional)</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function InfoCard({
  Icon,
  title,
  lines,
  href,
}: {
  Icon: typeof Mail;
  title: string;
  lines: string[];
  href?: string;
}) {
  const inner = (
    <div className="flex items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--color-surface-sunken)] text-[var(--color-brand)]">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {lines.map((l) => (
          <p key={l} className="text-sm text-[var(--color-content-muted)]">
            {l}
          </p>
        ))}
      </div>
    </div>
  );
  return href ? (
    <a href={href} className="block transition-shadow hover:shadow-md">
      {inner}
    </a>
  ) : (
    inner
  );
}
