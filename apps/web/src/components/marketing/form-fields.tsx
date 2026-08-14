'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/**
 * Marketing form controls (2026-08).
 *
 * The native <select> drops an OS-rendered list that no CSS can reach — on
 * Windows it lands as a stark white box with a hard blue highlight, which read
 * as unfinished next to the rest of the site. FancySelect is a listbox we own:
 * same data, brand styling, and the keyboard contract people expect (arrows,
 * Home/End, Enter, Escape, type-ahead) with focus kept on the trigger and the
 * active option announced through aria-activedescendant.
 */

export interface SelectOption {
  value: string;
  label: string;
  /** Shown on the closed trigger instead of `label` when space is tight. */
  short?: string;
  /** Optional leading glyph — the flag in the country picker. */
  prefix?: string;
  /** Optional trailing muted text — the dial code in the country picker. */
  suffix?: string;
}

export const fieldCls =
  'h-11 w-full rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3.5 text-sm outline-none transition-colors focus:border-[var(--color-brand)]';
export const labelCls = 'text-sm font-medium';
export const errCls = 'mt-1 text-xs text-[var(--tone-critical-fg)]';

export function FancySelect({
  id,
  value,
  onChange,
  options,
  ariaLabel,
  buttonClassName = '',
  placeholder = 'Select…',
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel?: string;
  buttonClassName?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = `${id}-listbox`;
  const selected = options.find((o) => o.value === value);

  // Close on outside click / Escape-from-anywhere, and keep the active option
  // scrolled into view while arrowing through a long list (the country picker).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function choose(index: number) {
    const opt = options[index];
    if (!opt) return;
    onChange(opt.value);
    setActive(index);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActive(Math.max(0, options.findIndex((o) => o.value === value)));
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1) {
      // Type-ahead: consecutive keystrokes inside a second build a prefix.
      const now = Date.now();
      typed.current.text = now - typed.current.at > 900 ? e.key : typed.current.text + e.key;
      typed.current.at = now;
      const needle = typed.current.text.toLowerCase();
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(needle));
      if (hit >= 0) setActive(hit);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
          setOpen((v) => !v);
        }}
        onKeyDown={onKeyDown}
        className={`${fieldCls} flex items-center justify-between gap-2 text-left ${
          open ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]/20' : ''
        } ${buttonClassName}`}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.prefix ? <span aria-hidden="true">{selected.prefix}</span> : null}
          <span className="truncate">{selected ? (selected.short ?? selected.label) : placeholder}</span>
          {selected?.short ? null : selected?.suffix ? (
            <span className="text-[var(--color-content-muted)]">{selected.suffix}</span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 flex-none text-[var(--color-content-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          className="absolute z-50 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-xl"
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            const isActive = i === active;
            return (
              <li key={o.value} id={`${id}-opt-${i}`} role="option" aria-selected={isSelected} data-active={isActive}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? 'bg-[var(--color-brand)] text-[var(--color-brand-contrast)]'
                      : 'text-[var(--color-content)]'
                  }`}
                >
                  {o.prefix ? <span aria-hidden="true">{o.prefix}</span> : null}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.suffix ? (
                    <span className={isActive ? 'text-[var(--color-brand-contrast)]/80' : 'text-[var(--color-content-muted)]'}>
                      {o.suffix}
                    </span>
                  ) : null}
                  {isSelected ? <Check aria-hidden="true" className="size-4 flex-none" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/* ── phone with country code ─────────────────────────────────────────────── */

/**
 * Dial codes people actually reach us from, India first — TechPIO's own base
 * and where most enquiries originate. Not an exhaustive ISO list: a 240-entry
 * scroll is worse for everyone than a short list plus a typed code.
 */
export const DIAL_CODES: SelectOption[] = [
  { value: '+91', label: 'India', short: '+91', prefix: '🇮🇳', suffix: '+91' },
  { value: '+1', label: 'USA / Canada', short: '+1', prefix: '🇺🇸', suffix: '+1' },
  { value: '+44', label: 'United Kingdom', short: '+44', prefix: '🇬🇧', suffix: '+44' },
  { value: '+971', label: 'UAE', short: '+971', prefix: '🇦🇪', suffix: '+971' },
  { value: '+966', label: 'Saudi Arabia', short: '+966', prefix: '🇸🇦', suffix: '+966' },
  { value: '+974', label: 'Qatar', short: '+974', prefix: '🇶🇦', suffix: '+974' },
  { value: '+965', label: 'Kuwait', short: '+965', prefix: '🇰🇼', suffix: '+965' },
  { value: '+968', label: 'Oman', short: '+968', prefix: '🇴🇲', suffix: '+968' },
  { value: '+973', label: 'Bahrain', short: '+973', prefix: '🇧🇭', suffix: '+973' },
  { value: '+61', label: 'Australia', short: '+61', prefix: '🇦🇺', suffix: '+61' },
  { value: '+64', label: 'New Zealand', short: '+64', prefix: '🇳🇿', suffix: '+64' },
  { value: '+65', label: 'Singapore', short: '+65', prefix: '🇸🇬', suffix: '+65' },
  { value: '+60', label: 'Malaysia', short: '+60', prefix: '🇲🇾', suffix: '+60' },
  { value: '+63', label: 'Philippines', short: '+63', prefix: '🇵🇭', suffix: '+63' },
  { value: '+62', label: 'Indonesia', short: '+62', prefix: '🇮🇩', suffix: '+62' },
  { value: '+66', label: 'Thailand', short: '+66', prefix: '🇹🇭', suffix: '+66' },
  { value: '+81', label: 'Japan', short: '+81', prefix: '🇯🇵', suffix: '+81' },
  { value: '+82', label: 'South Korea', short: '+82', prefix: '🇰🇷', suffix: '+82' },
  { value: '+86', label: 'China', short: '+86', prefix: '🇨🇳', suffix: '+86' },
  { value: '+852', label: 'Hong Kong', short: '+852', prefix: '🇭🇰', suffix: '+852' },
  { value: '+49', label: 'Germany', short: '+49', prefix: '🇩🇪', suffix: '+49' },
  { value: '+33', label: 'France', short: '+33', prefix: '🇫🇷', suffix: '+33' },
  { value: '+31', label: 'Netherlands', short: '+31', prefix: '🇳🇱', suffix: '+31' },
  { value: '+34', label: 'Spain', short: '+34', prefix: '🇪🇸', suffix: '+34' },
  { value: '+39', label: 'Italy', short: '+39', prefix: '🇮🇹', suffix: '+39' },
  { value: '+41', label: 'Switzerland', short: '+41', prefix: '🇨🇭', suffix: '+41' },
  { value: '+46', label: 'Sweden', short: '+46', prefix: '🇸🇪', suffix: '+46' },
  { value: '+353', label: 'Ireland', short: '+353', prefix: '🇮🇪', suffix: '+353' },
  { value: '+351', label: 'Portugal', short: '+351', prefix: '🇵🇹', suffix: '+351' },
  { value: '+48', label: 'Poland', short: '+48', prefix: '🇵🇱', suffix: '+48' },
  { value: '+27', label: 'South Africa', short: '+27', prefix: '🇿🇦', suffix: '+27' },
  { value: '+234', label: 'Nigeria', short: '+234', prefix: '🇳🇬', suffix: '+234' },
  { value: '+254', label: 'Kenya', short: '+254', prefix: '🇰🇪', suffix: '+254' },
  { value: '+20', label: 'Egypt', short: '+20', prefix: '🇪🇬', suffix: '+20' },
  { value: '+55', label: 'Brazil', short: '+55', prefix: '🇧🇷', suffix: '+55' },
  { value: '+52', label: 'Mexico', short: '+52', prefix: '🇲🇽', suffix: '+52' },
  { value: '+880', label: 'Bangladesh', short: '+880', prefix: '🇧🇩', suffix: '+880' },
  { value: '+92', label: 'Pakistan', short: '+92', prefix: '🇵🇰', suffix: '+92' },
  { value: '+94', label: 'Sri Lanka', short: '+94', prefix: '🇱🇰', suffix: '+94' },
  { value: '+977', label: 'Nepal', short: '+977', prefix: '🇳🇵', suffix: '+977' },
];

/** Country-code picker glued to a number input, sharing one bordered shell. */
export function PhoneField({
  idBase,
  code,
  onCodeChange,
  number,
  onNumberChange,
  error,
  label = 'Phone number',
}: {
  idBase: string;
  code: string;
  onCodeChange: (v: string) => void;
  number: string;
  onNumberChange: (v: string) => void;
  error?: string;
  label?: string;
}) {
  const hintId = useId();
  return (
    <div>
      <label htmlFor={`${idBase}-number`} className={labelCls}>
        {label}
      </label>
      <div className="mt-1.5 flex gap-2">
        <div className="w-[6.75rem] flex-none sm:w-[8rem]">
          <FancySelect
            id={`${idBase}-code`}
            value={code}
            onChange={onCodeChange}
            options={DIAL_CODES}
            ariaLabel="Country dialling code"
            buttonClassName="px-2.5"
          />
        </div>
        <input
          id={`${idBase}-number`}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="98765 43210"
          aria-describedby={hintId}
          value={number}
          onChange={(e) => onNumberChange(e.target.value)}
          className={fieldCls}
        />
      </div>
      <p id={hintId} className="sr-only">
        Enter your number without the country code; choose the code from the list beside it.
      </p>
      {error ? <p className={errCls}>{error}</p> : null}
    </div>
  );
}
