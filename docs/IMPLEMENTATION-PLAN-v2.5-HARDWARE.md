# TechpioAsset — v2.5 Implementation Plan: Discovery, Hardware Detail & Work Orders

> **Parent plan:** [IMPLEMENTATION-PLAN-v2.1.md](./IMPLEMENTATION-PLAN-v2.1.md) §3/§5 — the release map's
> **v2.5 = Discovery + Hardware detail + Maintenance work-orders (blueprint Phases 4 & 5)**. Source spec:
> blueprint Part B (Asset Details / Hardware redesign) and Volume III Part A (Maintenance FRD).
> **Prerequisites shipped:** v2.1–v2.4 live; v2.4's inventory module supplies the parts-consumption hook.

## 1. Goal

Make each hardware asset tell the truth about itself: what is inside it (discovered, not typed), how healthy
it is (a computed, capped score with recommendations), and what is being done about it (a real work-order
lifecycle with SLA timers and a technician's mobile view) — the blueprint's 7-tab asset page, powered by a
provider-pattern discovery layer.

## 2. Scope

**In (v2.5):**
- **Discovery framework** (the house provider pattern, like storage/AI/mail): a `DiscoveryProvider`
  interface with a **mock provider** (dev/tests) and an **agent-ingest endpoint** (authenticated JSON push
  carrying the hardware/OS/software payload). An **Intune/Graph connector built to the same contract** —
  configured via env, *not live-verifiable here* (no tenant), exactly like the Azure storage/Entra SSO
  precedent. Reconciliation: discovered devices matched to assets by serial number; unmatched and
  conflicting devices flagged for review, never auto-created.
- **Hardware profile entities**: `HardwareProfile`, `OperatingSystemInfo` (+ security posture fields),
  `InstalledSoftware`, `DiscoveredDevice` (staging + match state). M365Profile is **out** (needs Graph).
- **Asset health score** (blueprint B.7, faithfully): six weighted sub-scores — Battery 15, Storage 20,
  Memory 10, Warranty 15, Security 25, Updates 15 — grade bands Excellent→Critical, and the **capping
  rule** (Security or Storage < 40 caps the overall at Poor: safety-critical dimensions dominate). Pure
  domain logic + a recommendations engine emitting actionable strings.
- **7-tab asset detail (web)**: Overview · Hardware · OS & Security · Software · **Health** (score widget +
  recommendations) · History · Financials — extending the v2.2 tabs; tabs render honestly when no
  discovery data exists yet.
- **Maintenance work orders**: extend `MaintenanceRecord` with technician assignment, `slaDueAt` +
  escalation (the approvals pattern), diagnosis text, and **part consumption drawing from v2.4 stock**
  (guarded issue against a location, movement-ledgered). Preventive `MaintenanceSchedule` (simple
  recurrence → auto-creates REQUESTED work orders via the sweep).
- **Technician mobile**: my-work-orders list + detail (start/hold/complete with notes), reusing the
  honest-refusal patterns.
- QA `HW-*` / `MNT-*` runs with honest N/A annotations.

**Out (later, honestly):** live Intune/Graph verification (no tenant here), M365 tab, checklists/
e-signatures/vendor tickets on work orders (A.3.4–A.3.7), predictive health signals (A.3.9), agent
binaries (the ingest endpoint accepts pushes; shipping an agent is its own project).

## 3. Invariants

1. **Discovery never mutates assets silently** — reconciliation proposes; a human confirms matches that
   are not exact-serial; conflicts (same serial, different tag) are flagged, not merged.
2. **Health is derived, never stored authoritatively** — computed from the latest profile + warranty +
   security posture; cached with a computedAt, recomputed by the sweep.
3. **Part consumption is stock discipline** — drawing a part is the v2.4 guarded take (ledger row,
   honest refusal when unavailable), linked to the work order.
4. **SLA escalation mirrors approvals** — overdue IN_PROGRESS/SCHEDULED work orders escalate once,
   audited, to the maintenance manager.

## 4. Permissions

Reuse `maintenance:read/request/manage` (technician already holds manage). New: `discovery:read`,
`discovery:ingest` (agent principals/admins), `discovery:reconcile`. Matrix: IT_ADMIN + IT_TECHNICIAN
read/reconcile; ingest is SUPER_ADMIN/COMPANY_ADMIN + dedicated agent credential guidance. Seed re-run at
deploy (standing rule).

## 5. Workstreams

| WS | Deliverable |
|---|---|
| **H1 Domain + schema** | Entities + migrations (+RLS); `packages/domain/src/health.ts` — the six sub-scores, weights, bands, capping rule, recommendations — exhaustively unit-tested against B.7's table |
| **H2 Discovery API** | Provider interface + mock + Intune-to-contract; agent-ingest endpoint; reconciliation engine (exact-serial auto-match, propose/flag otherwise) + review endpoints |
| **H3 Work-order API** | Technician assignment, SLA timers + escalation sweep, diagnosis, part consumption via v2.4 stock (guarded), preventive schedules → sweep-created orders |
| **H4 Health + asset payload** | Health computation service + cache + sweep recompute; asset detail payload extended with hardware/OS/software/health |
| **H5 Web** | 7-tab asset detail with the health widget + recommendations; discovery review screen; work-order board with SLA indicators |
| **H6 Mobile** | Technician: my work orders, detail with start/hold/complete + part draw |
| **H7 Jobs + QA close-out** | Discovery-staleness + health-recompute + WO-escalation sweeps consolidated; QA `HW-*`/`MNT-*` scorecard; docs |

Sequencing: H1 → H2/H3 (parallel) → H4 → H5/H6 → H7. Cadence: small PRs into `v2.5`, one integration PR.

## 6. Acceptance criteria (traced)

1. Agent push ingests a device; exact-serial auto-matches; near-miss is proposed, conflict flagged; nothing
   auto-creates assets (HW-00x).
2. Health score reproduces B.7's table exactly, including the capping rule and grade bands; the widget and
   recommendations render on the Health tab (HW-01x, HW-004/017 from the release map).
3. Work order: assign → SLA → escalate-once (audited); part draw decrements stock through the ledger with
   honest refusals; preventive schedule spawns orders (MNT-*).
4. 7 tabs render with and without discovery data; technician mobile flow works against proven endpoints.
5. Zero regression; purely additive; full suite green (686 baseline + new); live web demo; deploy checklist
   (containers + seed + APK + outside-in).

## 7. Risks

- **No Intune tenant** — the connector ships built-to-contract with the mock proving the pipeline; stated
  honestly everywhere (the v1 provider-pattern precedent).
- **Health-score bikeshedding** — B.7's table is the contract; deviations documented, not improvised.
- **Scope creep on work orders** — checklists/e-sign/vendor tickets are explicitly out.
- **Estimate**: comparable to v2.4 (~7 PRs).

## 8. Phase gate

Standard: typecheck 9/9, full suites green, lint clean, QA scorecard on the epic, live demo, then **STOP
for explicit approval before deploy** (containers + seed re-run + APK rebuild + outside-in verification).
