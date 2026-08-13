/**
 * PioAssets brand mascot — a friendly monitor character, drawn as inline SVG
 * so it themes with the page and stays crisp at any size. Idle motion comes from
 * the `mascot-*` classes in globals.css and is frozen under reduced-motion.
 *
 * Illustration fills (screen blue, orange limbs, cheeks) are intentionally fixed
 * hex — they read on both light and dark grounds. Structural surfaces reference
 * the theme tokens so the floating cards match the rest of the page.
 */

/** Full hero scene: mascot on a glowing pedestal with floating app cards. */
export function AssetMascotHero() {
  return (
    <svg viewBox="0 0 540 470" className="h-auto w-full overflow-visible" role="img" aria-label="PioAssets mascot inspecting equipment">
      <defs>
        <radialGradient id="m-halo" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="m-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5CC6F5" />
          <stop offset="100%" stopColor="#2E8FE0" />
        </linearGradient>
        <linearGradient id="m-ped" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8FD3FF" />
          <stop offset="100%" stopColor="#5AA9F0" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="m-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EDF3FB" />
          <stop offset="100%" stopColor="#D4E1EF" />
        </linearGradient>
      </defs>

      {/* backdrop */}
      <ellipse cx="285" cy="205" rx="235" ry="205" fill="url(#m-halo)" />
      <path
        d="M120 120 Q150 40 270 55 Q430 70 460 170 Q490 280 380 330 Q250 385 150 320 Q60 260 120 120Z"
        fill="var(--color-brand)"
        opacity="0.06"
      />

      {/* stars */}
      <g className="mascot-twinkle">
        <path d="M470 90 l6 14 14 6 -14 6 -6 14 -6 -14 -14 -6 14 -6z" fill="#F6C544" />
      </g>
      <g className="mascot-twinkle" style={{ animationDelay: '0.8s' }}>
        <path d="M108 250 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4z" fill="var(--color-brand)" opacity="0.55" />
      </g>
      <g className="mascot-twinkle" style={{ animationDelay: '1.6s' }}>
        <path d="M420 300 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4z" fill="#F6C544" />
      </g>
      <g className="mascot-twinkle" style={{ animationDelay: '2.2s' }}>
        <path d="M150 90 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="var(--color-brand)" opacity="0.5" />
      </g>

      {/* floating app cards */}
      <g className="mascot-float">
        <rect x="70" y="150" width="62" height="62" rx="16" fill="var(--color-surface)" stroke="var(--color-border)" transform="rotate(-6 101 181)" />
        <g transform="translate(101 181) rotate(-6)" stroke="var(--color-tint-blue-fg)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect x="-14" y="-11" width="28" height="18" rx="2.5" />
          <path d="M-18 11h36" />
        </g>
      </g>
      <g className="mascot-float" style={{ animationDelay: '1.2s' }}>
        <rect x="410" y="120" width="64" height="64" rx="16" fill="var(--color-surface)" stroke="var(--color-border)" transform="rotate(7 442 152)" />
        <g transform="translate(442 152) rotate(7)" stroke="var(--color-tint-green-fg)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M0 -16l13 5v8c0 8-6 12-13 15-7-3-13-7-13-15v-8z" />
          <path d="M-6 0l4 4 8-8" />
        </g>
      </g>
      <g className="mascot-float" style={{ animationDelay: '1.8s' }}>
        <rect x="404" y="228" width="60" height="60" rx="15" fill="var(--color-surface)" stroke="var(--color-border)" transform="rotate(-5 434 258)" />
        <g transform="translate(434 258) rotate(-5)" stroke="var(--color-tint-purple-fg)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M-13 12V2M0 12V-6M13 12V-2" />
        </g>
      </g>
      <g className="mascot-float" style={{ animationDelay: '0.3s' }}>
        <rect x="78" y="290" width="58" height="58" rx="15" fill="var(--color-surface)" stroke="var(--color-border)" transform="rotate(6 107 319)" />
        <g transform="translate(107 319) rotate(6)" stroke="var(--color-tint-amber-fg)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M-9 -14h13l6 6v22h-19z" />
          <path d="M4 -14v6h6M-4 2h10M-4 8h10" />
        </g>
      </g>

      {/* pedestal */}
      <ellipse cx="270" cy="405" rx="120" ry="26" fill="url(#m-ped)" />
      <ellipse cx="270" cy="405" rx="92" ry="17" fill="var(--color-brand)" opacity="0.16" />

      {/* mascot */}
      <g className="mascot-bob">
        {/* legs */}
        <path d="M243 372 q-4 22 -16 30" stroke="#F2A65A" strokeWidth="9" fill="none" strokeLinecap="round" />
        <path d="M297 372 q4 22 16 30" stroke="#F2A65A" strokeWidth="9" fill="none" strokeLinecap="round" />
        <ellipse cx="222" cy="405" rx="13" ry="7" fill="#F2A65A" />
        <ellipse cx="318" cy="405" rx="13" ry="7" fill="#F2A65A" />

        {/* left arm + clipboard */}
        <path d="M212 250 q-46 6 -66 40" stroke="#F2A65A" strokeWidth="9" fill="none" strokeLinecap="round" />
        <g transform="rotate(-13 150 292)">
          <rect x="120" y="258" width="60" height="74" rx="8" fill="#FFFFFF" stroke="#C9D6E6" strokeWidth="2" />
          <rect x="138" y="250" width="24" height="13" rx="4" fill="#B9C6D8" />
          <path d="M132 280l6 6 12-13" stroke="#3FBE7A" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M132 300l6 6 12-13" stroke="#3FBE7A" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M156 282h16M156 302h16" stroke="#CBD6E4" strokeWidth="3" strokeLinecap="round" />
        </g>

        {/* right arm + magnifier */}
        <path d="M328 250 q44 4 62 34" stroke="#F2A65A" strokeWidth="9" fill="none" strokeLinecap="round" />
        <g transform="translate(392 288)">
          <circle cx="0" cy="0" r="17" fill="#DCEFFF" stroke="#F2A65A" strokeWidth="6" />
          <circle cx="0" cy="0" r="17" fill="none" stroke="#FFFFFF" strokeWidth="2" opacity="0.7" />
          <path d="M13 13l16 16" stroke="#F2A65A" strokeWidth="8" strokeLinecap="round" />
        </g>

        {/* body + screen */}
        <rect x="196" y="150" width="148" height="130" rx="26" fill="url(#m-body)" stroke="#B7C6D8" strokeWidth="2.5" />
        <rect x="212" y="166" width="116" height="86" rx="15" fill="url(#m-screen)" />
        <rect x="224" y="178" width="16" height="16" rx="4" fill="#FF6F61" />
        <rect x="245" y="178" width="16" height="16" rx="4" fill="#FFD25A" />
        <rect x="266" y="178" width="16" height="16" rx="4" fill="#7FE0B0" opacity="0.9" />
        <path d="M226 205h40M226 216h56M226 227h30" stroke="#EAF6FF" strokeWidth="4" strokeLinecap="round" opacity="0.85" />

        {/* face */}
        <circle cx="252" cy="218" r="5.6" fill="#22364F" />
        <circle cx="288" cy="218" r="5.6" fill="#22364F" />
        <circle cx="254" cy="216" r="1.8" fill="#fff" />
        <circle cx="290" cy="216" r="1.8" fill="#fff" />
        <path d="M258 230 q12 12 24 0" stroke="#22364F" strokeWidth="4.2" fill="none" strokeLinecap="round" />
        <ellipse cx="238" cy="230" rx="7" ry="4.5" fill="#FF9AA2" opacity="0.7" />
        <ellipse cx="302" cy="230" rx="7" ry="4.5" fill="#FF9AA2" opacity="0.7" />

        {/* name bar */}
        <rect x="222" y="286" width="96" height="26" rx="10" fill="#F3ECDA" stroke="#E0D5BC" strokeWidth="1.5" />
        <text x="270" y="303" textAnchor="middle" fontFamily="system-ui, Segoe UI, sans-serif" fontSize="12.5" fontWeight="800" fill="#2E5AAC" letterSpacing="-0.02em">
          techpioasset.com
        </text>
        <rect x="256" y="278" width="28" height="10" rx="3" fill="#C6D2E0" />
      </g>

      {/* potted plant */}
      <g transform="translate(420 358)">
        <path d="M6 18 Q-8 -6 -18 -14 Q-2 -8 6 8" fill="#4FB477" />
        <path d="M6 16 Q20 -8 34 -14 Q16 -6 6 10" fill="#3FA268" />
        <path d="M6 18 Q6 -14 6 -22 Q12 -6 10 14" fill="#5CC085" />
        <path d="M-12 18h36l-5 22h-26z" fill="#3D7ED6" />
        <path d="M-12 18h36l-2 8h-32z" fill="#5A97E8" />
      </g>
    </svg>
  );
}

/** Compact waving mascot for the closing call-to-action band (on brand blue). */
export function AssetMascotWave() {
  return (
    <svg viewBox="0 0 260 210" className="h-auto w-[78%] max-w-[280px] overflow-visible" role="img" aria-label="PioAssets mascot waving hello">
      <defs>
        <linearGradient id="mw-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5CC6F5" />
          <stop offset="100%" stopColor="#2E8FE0" />
        </linearGradient>
      </defs>
      <ellipse cx="130" cy="188" rx="78" ry="15" fill="#fff" opacity="0.14" />
      <g className="mascot-bob">
        <path d="M112 150 q-6 20 -16 26" stroke="#F2A65A" strokeWidth="8" fill="none" strokeLinecap="round" />
        <path d="M150 150 q6 20 16 26" stroke="#F2A65A" strokeWidth="8" fill="none" strokeLinecap="round" />
        <ellipse cx="94" cy="180" rx="11" ry="6" fill="#F2A65A" />
        <ellipse cx="170" cy="180" rx="11" ry="6" fill="#F2A65A" />
        <path d="M98 96 q-34 -16 -44 -40" stroke="#F2A65A" strokeWidth="8" fill="none" strokeLinecap="round" />
        <circle cx="52" cy="52" r="8" fill="#F2A65A" />
        <path d="M170 108 q30 8 40 30" stroke="#F2A65A" strokeWidth="8" fill="none" strokeLinecap="round" />
        <rect x="86" y="60" width="118" height="104" rx="22" fill="#EDF3FB" stroke="#B7C6D8" strokeWidth="2.2" />
        <rect x="100" y="74" width="90" height="66" rx="12" fill="url(#mw-screen)" />
        <circle cx="130" cy="104" r="5" fill="#22364F" />
        <circle cx="160" cy="104" r="5" fill="#22364F" />
        <path d="M133 116 q10 10 20 0" stroke="#22364F" strokeWidth="3.6" fill="none" strokeLinecap="round" />
        <ellipse cx="118" cy="116" rx="6" ry="4" fill="#FF9AA2" opacity="0.7" />
        <ellipse cx="172" cy="116" rx="6" ry="4" fill="#FF9AA2" opacity="0.7" />
        <rect x="108" y="146" width="74" height="20" rx="8" fill="#F3ECDA" />
        <text x="145" y="160" textAnchor="middle" fontFamily="system-ui, sans-serif" fontSize="9.5" fontWeight="800" fill="#2E5AAC">
          techpioasset.com
        </text>
      </g>
      <path d="M40 40 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4z" fill="#fff" opacity="0.9" className="mascot-twinkle" />
      <path d="M224 66 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4z" fill="#FFD25A" className="mascot-twinkle" style={{ animationDelay: '0.8s' }} />
    </svg>
  );
}
