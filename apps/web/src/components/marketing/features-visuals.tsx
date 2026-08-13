'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  QrCode,
  ScanLine,
  Search,
  ShieldAlert,
  Smartphone,
  Wrench,
} from 'lucide-react';
import { Counter } from './motion';

/**
 * Interactive pieces of the Features page (2026-08). Everything here mirrors
 * real product behaviour - the asset record fields, lifecycle stages, search
 * and alerts all exist in PioAssets; nothing is invented. Motion rides the
 * mkt-* classes and freezes under prefers-reduced-motion.
 */

/* ── sticky category navigation ─────────────────────────────────────────── */

const CATEGORIES = [
  ['assets', 'Asset Management'],
  ['discovery', 'Discovery'],
  ['assignment', 'Assignment'],
  ['lifecycle', 'Lifecycle'],
  ['warranty', 'Warranty'],
  ['maintenance', 'Maintenance'],
  ['qr', 'QR & Barcode'],
  ['reporting', 'Reporting'],
  ['security', 'Security'],
  ['administration', 'Administration'],
  ['integrations', 'Integrations'],
  ['automation', 'Automation'],
] as const;

export function FeatureNav() {
  const [active, setActive] = useState<string>('assets');

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: '-25% 0px -65% 0px' },
    );
    for (const [id] of CATEGORIES) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return (
    <nav
      aria-label="Feature categories"
      className="sticky top-14 z-30 border-b border-[var(--color-border)] bg-[var(--color-background)]/90 backdrop-blur"
    >
      <div className="mx-auto max-w-6xl overflow-x-auto px-5">
        <ul className="flex min-w-max gap-1 py-2">
          {CATEGORIES.map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className={`block whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  active === id
                    ? 'bg-[var(--color-brand)] text-[var(--color-brand-contrast)]'
                    : 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)]'
                }`}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/* ── hero: panels assembling into a product surface ─────────────────────── */

export function HeroPanels() {
  return (
    <div className="relative mx-auto w-full max-w-[560px]" role="img" aria-label="PioAssets asset management centre: device, people and warranty counters, the asset lifecycle, and a live activity feed">
      <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-2xl">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-content-subtle)]">
          PioAssets · Asset Management Center
        </p>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            ['Devices', <Counter key="d" to={1248} />, ''],
            ['People', <Counter key="p" to={842} />, ''],
            ['Warranty', <Counter key="w" to={43} />, 'text-[var(--tone-warning-fg)]'],
          ].map(([label, value, cls], i) => (
            <div key={i} className="mkt-pop rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 py-3 text-center" style={{ animationDelay: `${0.2 + i * 0.2}s` }}>
              <p className={`text-xl font-bold tabular-nums ${cls}`}>{value}</p>
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-content-subtle)]">{label}</p>
            </div>
          ))}
        </div>

        <div className="mkt-pop mt-3 rounded-2xl border border-[var(--color-border)] p-4" style={{ animationDelay: '0.9s' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">Asset lifecycle</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
            {['Purchase', 'Assign', 'Maintain', 'Retire'].map((s, i) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={`rounded-full px-2.5 py-1 ${i === 1 ? 'bg-[var(--color-brand)] text-[var(--color-brand-contrast)]' : 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]'}`}>{s}</span>
                {i < 3 ? <ChevronRight aria-hidden="true" className="size-3.5 text-[var(--color-content-subtle)]" /> : null}
              </span>
            ))}
          </div>
        </div>

        <div className="mkt-pop mt-3 rounded-2xl border border-[var(--color-border)] p-4" style={{ animationDelay: '1.3s' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">Recent activity</p>
          <ul className="mt-2 grid grid-cols-1 gap-1.5 text-xs text-[var(--color-content-muted)]">
            <li className="flex items-center gap-2"><CheckCircle2 aria-hidden="true" className="size-3.5 flex-none text-[var(--tone-success-fg)]" /> Laptop assigned to Alex Morgan</li>
            <li className="flex items-center gap-2"><ShieldAlert aria-hidden="true" className="size-3.5 flex-none text-[var(--tone-warning-fg)]" /> Warranty expiring: Dell Latitude 5540</li>
            <li className="flex items-center gap-2"><CheckCircle2 aria-hidden="true" className="size-3.5 flex-none text-[var(--tone-success-fg)]" /> Asset transferred to Chandigarh office</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ── interactive asset record (hover highlights fields) ─────────────────── */

const RECORD: [string, string][] = [
  ['Asset ID', 'PIO-01241'],
  ['Serial number', 'C02XL7PIO14'],
  ['Status', 'In use'],
  ['Assigned to', 'Alex Morgan'],
  ['Department', 'Engineering'],
  ['Location', 'Chandigarh'],
  ['Purchase date', '12 Mar 2026'],
  ['Purchase cost', '$1,899'],
  ['Warranty', '87 days remaining'],
  ['Condition', 'Excellent'],
];

export function AssetRecord() {
  return (
    <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-bold tracking-tight">MacBook Pro 14&Prime;</p>
          <p className="text-xs text-[var(--color-content-subtle)]">One record — identity, ownership, money and history together</p>
        </div>
        <span className="rounded-full bg-[var(--color-tint-green)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-tint-green-fg)]">In use</span>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2">
        {RECORD.map(([k, v]) => (
          <div key={k} className="group bg-[var(--color-surface)] px-4 py-2.5 transition-colors hover:bg-[var(--color-brand)]/8">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-content-subtle)] group-hover:text-[var(--color-brand)]">{k}</dt>
            <dd className="mt-0.5 text-sm font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ── interactive lifecycle explorer ─────────────────────────────────────── */

const STAGES: { key: string; label: string; detail: string; facts: [string, string][] }[] = [
  { key: 'purchase', label: 'Purchase', detail: 'The record starts with the money: cost, vendor, order and warranty terms are captured at the source.', facts: [['Cost', '$1,899'], ['Vendor', 'Authorized reseller'], ['Order', 'PO-2026-114'], ['Warranty', '3 years']] },
  { key: 'receive', label: 'Receive', detail: 'Goods-in confirms what physically arrived against what was ordered.', facts: [['Received', '10 Mar 2026'], ['Condition', 'New'], ['Checked by', 'IT stores']] },
  { key: 'register', label: 'Register', detail: 'The asset gets its permanent identity: tag, serial, category and a printable QR label.', facts: [['Asset ID', 'PIO-01241'], ['Serial', 'C02XL7PIO14'], ['QR label', 'Printed']] },
  { key: 'assign', label: 'Assign', detail: 'Handed to a person with condition recorded; the holder confirms receipt from their phone.', facts: [['Holder', 'Alex Morgan'], ['Receipt', 'Confirmed'], ['Accessories', 'Charger, sleeve']] },
  { key: 'use', label: 'Use', detail: 'Day-to-day custody: location, condition and any raised issues stay attached to the record.', facts: [['Location', 'Chandigarh'], ['Condition', 'Excellent'], ['Open issues', 'None']] },
  { key: 'maintain', label: 'Maintain', detail: 'Repairs and servicing live on the asset: what happened, who did it, what it cost, how long it was down.', facts: [['Last service', 'Screen replacement'], ['Technician', 'John'], ['Cost', '$180'], ['Downtime', '2 days']] },
  { key: 'transfer', label: 'Transfer', detail: 'Moves between people or offices follow a tracked handover — never a quiet swap.', facts: [['Type', 'Office transfer'], ['In transit', 'Tracked'], ['Arrival', 'Confirmed']] },
  { key: 'return', label: 'Return', detail: 'Equipment comes back to stock with its condition checked and accessories accounted for.', facts: [['Returned', '02 Jul 2026'], ['Condition in', 'Good'], ['Back to', 'IT stock']] },
  { key: 'retire', label: 'Retire', detail: 'Disposal, donation or write-off is recorded — and the full history stays queryable forever.', facts: [['Method', 'Certified recycling'], ['Approved by', 'IT manager'], ['History', 'Retained']] },
];

export function LifecycleExplorer() {
  const [stage, setStage] = useState('maintain');
  const current = STAGES.find((s) => s.key === stage)!;

  return (
    <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-lg sm:p-7">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Lifecycle stages">
        {STAGES.map((s, i) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={stage === s.key}
            onClick={() => setStage(s.key)}
            className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              stage === s.key
                ? 'bg-[var(--color-brand)] text-[var(--color-brand-contrast)]'
                : 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)] hover:text-[var(--color-content)]'
            }`}
          >
            <span className="font-mono text-[10px] opacity-70">{String(i + 1).padStart(2, '0')}</span>
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-[1fr_260px]">
        <div>
          <p className="text-lg font-semibold tracking-tight">{current.label}</p>
          <p className="mt-2 leading-relaxed text-[var(--color-content-muted)]">{current.detail}</p>
          <div aria-hidden="true" className="mt-5 flex h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
            <span
              className="rounded-full bg-[var(--color-brand)] transition-all duration-500"
              style={{ width: `${((STAGES.findIndex((s) => s.key === stage) + 1) / STAGES.length) * 100}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-content-subtle)]">
            Stage {STAGES.findIndex((s) => s.key === stage) + 1} of {STAGES.length} — the record carries every stage it has passed through.
          </p>
        </div>
        <dl className="grid content-start gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-4 text-sm">
          {current.facts.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-[var(--color-content-subtle)]">{k}</dt>
              <dd className="text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/* ── search demo ────────────────────────────────────────────────────────── */

const SEARCHABLE = [
  ['MacBook Pro 14″', 'PIO-01241', 'Alex Morgan · Engineering'],
  ['MacBook Pro 16″', 'PIO-01104', 'Priya Raman · Design'],
  ['MacBook Pro 14″', 'PIO-00983', 'IT stock · Chandigarh'],
  ['Dell Latitude 5540', 'PIO-01198', 'Sarah Lee · Operations'],
  ['HP ProBook 450', 'PIO-00761', 'Maintenance · Service bay'],
] as const;

export function SearchDemo() {
  const [q, setQ] = useState('MacBook Pro');
  const results = SEARCHABLE.filter((r) => `${r[0]} ${r[1]} ${r[2]}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-lg">
      <div className="flex h-11 items-center gap-2.5 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-sunken)] px-3.5 focus-within:border-[var(--color-brand)]">
        <Search aria-hidden="true" className="size-4 text-[var(--color-content-subtle)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Try the asset search"
          className="w-full bg-transparent text-sm outline-none"
          placeholder="Search assets, serials, people…"
        />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] font-medium text-[var(--color-content-muted)]">
        {['Status', 'Department', 'Location', 'Category', 'User', 'Warranty', 'Condition'].map((f) => (
          <span key={f} className="rounded-full border border-[var(--color-border)] px-2.5 py-1">{f}</span>
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-2">
        {results.length === 0 ? (
          <li className="rounded-xl bg-[var(--color-surface-sunken)] px-4 py-3 text-sm text-[var(--color-content-subtle)]">No matches — try &ldquo;MacBook&rdquo; or a PIO id.</li>
        ) : (
          results.map(([name, id, holder]) => (
            <li key={id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--color-surface-sunken)] px-4 py-2.5 transition-colors hover:bg-[var(--color-brand)]/8">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{name}</p>
                <p className="truncate text-xs text-[var(--color-content-muted)]">{holder}</p>
              </div>
              <span className="flex-none font-mono text-xs text-[var(--color-brand)]">{id}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/* ── QR scan story ──────────────────────────────────────────────────────── */

export function QrScanStory() {
  return (
    <div className="relative mx-auto grid max-w-md gap-0" role="img" aria-label="A phone scans an asset QR label and opens the full asset profile with actions to verify, assign, transfer or report an issue">
      <div className="mx-auto flex items-center gap-6">
        {/* laptop with QR label */}
        <div className="relative">
          <svg width="120" height="86" viewBox="0 0 120 86" aria-hidden="true">
            <rect x="18" y="6" width="84" height="56" rx="6" fill="var(--color-surface-sunken)" stroke="var(--color-border-strong)" strokeWidth="2" />
            <rect x="26" y="14" width="68" height="40" rx="3" fill="#0b1d3a" />
            <path d="M10 64 h100 l8 12 a3 3 0 0 1 -3 4 H5 a3 3 0 0 1 -3 -4 Z" fill="var(--color-surface-sunken)" stroke="var(--color-border-strong)" strokeWidth="2" />
            <rect x="76" y="34" width="16" height="16" rx="2" fill="#fff" stroke="var(--color-border-strong)" />
            <g fill="#0b1d3a">
              <rect x="78.5" y="36.5" width="4" height="4" /><rect x="85.5" y="36.5" width="4" height="4" />
              <rect x="78.5" y="43.5" width="4" height="4" /><rect x="86" y="44" width="3" height="3" />
            </g>
          </svg>
          <span className="mkt-scanline absolute left-[70px] top-8 block h-0.5 w-[30px] rounded bg-[var(--tone-success-fg)]" aria-hidden="true" />
        </div>
        {/* phone */}
        <div className="w-[150px] flex-none rounded-[1.4rem] border-[3px] border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2.5 shadow-xl">
          <div className="mx-auto mb-1.5 h-1 w-8 rounded-full bg-[var(--color-border-strong)]" aria-hidden="true" />
          <p className="flex items-center gap-1 text-[10px] font-semibold text-[var(--tone-success-fg)]">
            <ScanLine aria-hidden="true" className="size-3" /> Asset detected
          </p>
          <div className="mkt-pop mt-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-2" style={{ animationDelay: '0.6s' }}>
            <p className="text-[11px] font-bold">MacBook Pro 14&Prime;</p>
            <p className="text-[9px] text-[var(--color-content-subtle)]">PIO-01241 · In use · Alex M.</p>
          </div>
          <div className="mkt-pop mt-1.5 grid grid-cols-2 gap-1" style={{ animationDelay: '1s' }}>
            {['Verify', 'Assign', 'Transfer', 'Report issue'].map((a, i) => (
              <span key={a} className={`rounded-md px-1.5 py-1 text-center text-[9px] font-semibold ${i === 0 ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]'}`}>{a}</span>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-[var(--color-content-subtle)]">
        <QrCode aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
        Every asset gets a printable QR label; the Android app opens the record on the spot.
      </p>
    </div>
  );
}

/* ── notifications strip ────────────────────────────────────────────────── */

const ALERTS = [
  ['warn', 'Warranty expires in 14 days — Dell Latitude 5540'],
  ['warn', 'Asset overdue for return — loaner tablet'],
  ['warn', 'Maintenance due this week — 12 work orders'],
  ['warn', 'License renewal approaching — 25 seats'],
  ['ok', 'Asset successfully assigned — receipt confirmed'],
] as const;

export function AlertsStrip() {
  return (
    <ul className="grid grid-cols-1 gap-2.5">
      {ALERTS.map(([kind, text], i) => (
        <li
          key={text}
          className="mkt-pop flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-sm"
          style={{ animationDelay: `${i * 0.15}s` }}
        >
          {kind === 'warn' ? (
            <Bell aria-hidden="true" className="size-4 flex-none text-[var(--tone-warning-fg)]" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="size-4 flex-none text-[var(--tone-success-fg)]" />
          )}
          <span className="text-sm text-[var(--color-content-muted)]">{text}</span>
        </li>
      ))}
    </ul>
  );
}

/* ── mobile field ops phone ─────────────────────────────────────────────── */

export function FieldPhone() {
  return (
    <div className="mx-auto w-[230px] rounded-[2rem] border-4 border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3.5 shadow-2xl" role="img" aria-label="PioAssets mobile app showing a stock-take in progress with scanned assets and one pending sync">
      <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-[var(--color-border-strong)]" aria-hidden="true" />
      <p className="text-xs font-bold">Stock-take · Chandigarh</p>
      <p className="text-[10px] text-[var(--color-content-subtle)]">18 of 24 verified</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]" aria-hidden="true">
        <span className="block h-full w-3/4 rounded-full bg-[var(--color-brand)]" />
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-1.5 text-[11px]">
        {[
          ['MacBook Pro 14″', 'Verified', 'ok'],
          ['Dell Latitude 5540', 'Verified', 'ok'],
          ['Monitor · P2422H', 'Scanned — offline, will sync', 'wait'],
        ].map(([name, state, kind]) => (
          <li key={name} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-surface-sunken)] px-2.5 py-2">
            <span className="min-w-0 truncate font-medium">{name}</span>
            <span className={`flex-none text-[9px] font-semibold ${kind === 'ok' ? 'text-[var(--tone-success-fg)]' : 'text-[var(--tone-warning-fg)]'}`}>{state}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--color-brand)] px-3 py-2 text-white">
        <span className="text-[10px] font-semibold">Continue scanning</span>
        <Smartphone aria-hidden="true" className="size-3.5" />
      </div>
    </div>
  );
}

/* ── maintenance timeline (scroll-revealed rows) ────────────────────────── */

export function ServiceTimeline() {
  const items = [
    ['12 Aug 2026', 'Screen replacement', '$180 · Technician: John · 2 days downtime'],
    ['05 May 2026', 'Battery service', '$95 · Under warranty · same-day'],
    ['02 Apr 2026', 'Keyboard cleaning', 'No cost · preventive'],
    ['12 Mar 2026', 'Initial registration', 'Condition: new · warranty starts'],
  ] as const;
  const ref = useRef<HTMLOListElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setSeen(true), io.disconnect()), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <ol ref={ref} className="relative border-l-2 border-[var(--color-brand)]/25 pl-7">
      {items.map(([date, title, meta], i) => (
        <li key={date} className={seen ? 'mkt-pop relative pb-7 last:pb-0' : 'relative pb-7 opacity-0 last:pb-0'} style={{ animationDelay: `${i * 0.18}s` }}>
          <span aria-hidden="true" className={`absolute -left-[37px] top-1 grid size-5 place-items-center rounded-full ${i === 0 ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-surface-sunken)] border border-[var(--color-border-strong)]'}`}>
            {i === 0 ? <Wrench aria-hidden="true" className="size-2.5 text-white" /> : null}
          </span>
          <p className="font-mono text-xs text-[var(--color-content-subtle)]">{date}</p>
          <p className="mt-0.5 font-semibold">{title}</p>
          <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">{meta}</p>
        </li>
      ))}
    </ol>
  );
}
