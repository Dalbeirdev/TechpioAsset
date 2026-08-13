'use client';

import { BadgeCheck, Bell, CheckCircle2, QrCode, ShieldCheck, Wrench } from 'lucide-react';
import { Counter } from './motion';

/**
 * Hero scene (2026-08 redesign): the lifecycle told as a 14-second loop.
 * A laptop is scanned (QR beam), becomes a registered asset card, gains a
 * warranty badge, raises a maintenance alert, and syncs into the mini
 * dashboard beside it - the actual PioAssets story in one glance. Windows for
 * each beat live in globals.css (mkt-cycle-*); reduced-motion shows the whole
 * finished scene statically.
 */

export function HeroLifecycleScene() {
  return (
    <div className="relative mx-auto w-full max-w-[560px]" aria-label="Animated example: a laptop is scanned, registered, covered by warranty, flagged for maintenance, and synced to the PioAssets dashboard" role="img">
      {/* Mini dashboard the story feeds into */}
      <div className="relative z-10 ml-auto w-full rounded-3xl sm:w-[78%] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
            PioAssets · Live overview
          </p>
          <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--tone-success-fg)]">
            <span className="mkt-ring size-2 rounded-full bg-[var(--tone-success-fg)]" /> Synced
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Kpi label="Total assets" value={<Counter to={1248} />} />
          <Kpi label="Active" value={<Counter to={982} />} tone="green" />
          <Kpi label="Maintenance" value={<Counter to={34} />} tone="amber" />
          <Kpi label="Warranty expiring" value={<Counter to={43} />} tone="amber" />
          <Kpi label="Asset value" value={<Counter to={1.84} prefix="$" suffix="M" decimals={2} />} />
          <Kpi label="Locations" value={<Counter to={6} />} />
        </div>

        <ul className="mt-3 grid grid-cols-1 gap-1.5 text-xs">
          <Activity icon={<CheckCircle2 className="size-3.5 text-[var(--tone-success-fg)]" />} text="MacBook Pro assigned to Alex" delay={0.4} />
          <Activity icon={<CheckCircle2 className="size-3.5 text-[var(--tone-success-fg)]" />} text="Dell Latitude warranty updated" delay={1.0} />
          <Activity icon={<Bell className="size-3.5 text-[var(--tone-warning-fg)]" />} text="12 licences expiring this quarter" delay={1.6} />
          <Activity icon={<CheckCircle2 className="size-3.5 text-[var(--tone-success-fg)]" />} text="iPhone 14 returned to stock" delay={2.2} />
        </ul>
      </div>

      {/* The story: device being scanned into the system */}
      <div className="relative z-20 -mt-8 w-[86%] sm:-mt-14 sm:w-[64%]">
        <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg">
          <div className="flex items-start gap-3">
            {/* laptop + scan beam */}
            <div className="relative">
              <svg width="92" height="66" viewBox="0 0 92 66" aria-hidden="true">
                <rect x="14" y="4" width="64" height="42" rx="5" fill="var(--color-surface-sunken)" stroke="var(--color-border-strong)" strokeWidth="2" />
                <rect x="20" y="10" width="52" height="30" rx="2" fill="#0b1d3a" />
                <g stroke="#60a5fa" strokeWidth="2" strokeLinecap="round">
                  <path d="M25 18 h18 M25 24 h26 M25 30 h14" />
                </g>
                <path d="M8 48 h76 l6 10 a3 3 0 0 1 -3 4 H5 a3 3 0 0 1 -3 -4 Z" fill="var(--color-surface-sunken)" stroke="var(--color-border-strong)" strokeWidth="2" />
              </svg>
              <span className="mkt-scanline absolute top-2 left-4 block h-0.5 w-[64px] rounded bg-[var(--color-brand)]" aria-hidden="true" />
              <span className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-lg bg-[var(--color-brand)] text-white shadow">
                <QrCode className="size-4" aria-hidden="true" />
              </span>
            </div>
            {/* registered record */}
            <div className="mkt-cycle-a min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">MacBook Pro 14&Prime;</p>
              <p className="text-xs text-[var(--color-content-muted)]">Asset ID: PIO-01241</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-[var(--color-tint-green)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-tint-green-fg)]">
                  In use
                </span>
                <span className="rounded-full bg-[var(--color-tint-blue)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-tint-blue-fg)]">
                  Assigned to Alex
                </span>
              </div>
            </div>
          </div>

          {/* warranty + maintenance beats */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="mkt-cycle-b flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-2.5 py-2">
              <ShieldCheck className="size-4 flex-none text-[var(--color-brand)]" aria-hidden="true" />
              <div className="min-w-0 text-xs">
                <p className="font-semibold">Warranty</p>
                <p className="text-[var(--color-content-muted)]">87 days left</p>
              </div>
            </div>
            <div className="mkt-cycle-c flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-2.5 py-2">
              <Wrench className="size-4 flex-none text-[var(--tone-warning-fg)]" aria-hidden="true" />
              <div className="min-w-0 text-xs">
                <p className="font-semibold">Service due</p>
                <p className="text-[var(--color-content-muted)]">Battery check</p>
              </div>
            </div>
          </div>
        </div>

        {/* sync connector into the dashboard */}
        <svg className="pointer-events-none absolute -right-14 top-6 hidden h-24 w-16 sm:block" viewBox="0 0 64 96" aria-hidden="true">
          <path d="M4 88 C 36 78, 52 46, 56 8" fill="none" stroke="var(--color-brand)" strokeWidth="2" className="mkt-flow" opacity="0.55" />
        </svg>
      </div>

      {/* mascot buddy - a small monitor face keeping watch */}
      <div className="mkt-cycle-d absolute -left-2 bottom-2 z-30 hidden sm:block" aria-hidden="true">
        <svg width="84" height="92" viewBox="0 0 84 92">
          <line x1="42" y1="10" x2="42" y2="2" stroke="#F6A93B" strokeWidth="3" strokeLinecap="round" />
          <circle cx="42" cy="4" r="3.5" fill="#F6C544" />
          <rect x="8" y="10" width="68" height="50" rx="12" fill="#2E8FE0" />
          <rect x="13" y="15" width="58" height="40" rx="8" fill="#5CC6F5" />
          <circle cx="31" cy="32" r="4.4" fill="#0b1d3a" />
          <circle cx="53" cy="32" r="4.4" fill="#0b1d3a" />
          <circle cx="32.6" cy="30.6" r="1.4" fill="#fff" />
          <circle cx="54.6" cy="30.6" r="1.4" fill="#fff" />
          <path d="M34 42 Q42 49 50 42" stroke="#0b1d3a" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="24" cy="40" r="3.4" fill="#FF9FB0" opacity="0.8" />
          <circle cx="60" cy="40" r="3.4" fill="#FF9FB0" opacity="0.8" />
          <rect x="34" y="60" width="16" height="8" rx="3" fill="#2E8FE0" />
          <rect x="24" y="68" width="36" height="9" rx="4.5" fill="#D4E1EF" />
          <g className="mascot-bob">
            <circle cx="10" cy="76" r="6.5" fill="#F6C544" />
            <BadgeCheckMark />
          </g>
        </svg>
      </div>
    </div>
  );
}

function BadgeCheckMark() {
  return <path d="M7 76 l2.2 2.2 4 -4" stroke="#7a5a00" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
}

function Kpi({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'green' | 'amber' }) {
  const toneCls =
    tone === 'green'
      ? 'text-[var(--tone-success-fg)]'
      : tone === 'amber'
        ? 'text-[var(--tone-warning-fg)]'
        : 'text-[var(--color-content)]';
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-2.5 py-2">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-[var(--color-content-subtle)]">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${toneCls}`}>{value}</p>
    </div>
  );
}

function Activity({ icon, text, delay }: { icon: React.ReactNode; text: string; delay: number }) {
  return (
    <li className="mkt-pop flex items-center gap-2 rounded-lg bg-[var(--color-surface-sunken)] px-2.5 py-1.5" style={{ animationDelay: `${delay}s` }}>
      <span className="flex-none" aria-hidden="true">{icon}</span>
      <span className="truncate text-[var(--color-content-muted)]">{text}</span>
    </li>
  );
}

export function TrustBadge() {
  return (
    <p className="mt-5 flex items-center gap-2 text-sm text-[var(--color-content-subtle)]">
      <BadgeCheck aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
      One platform for your complete IT asset lifecycle.
    </p>
  );
}
