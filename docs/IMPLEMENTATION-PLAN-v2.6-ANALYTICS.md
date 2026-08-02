# v2.6 — Analytics, Integrations & the Platform Plane

> **Status:** Proposed — awaiting approval before build.
> **Blueprint phase:** 6 (the final phase of the committed release map, `IMPLEMENTATION-PLAN-v2.1.md` §3/§5).
> **Baseline:** prod runs v1+v2.1+v2.2+v2.3+v2.4+v2.5 (merge `0b2605e`), 442u+287i tests green.

## 1. Goal

Close the release map: executive analytics on top of six releases of real data, the
scheduled-report **runner** (the long-standing v1 gap — `ScheduledReport` CRUD and the cron
engine exist, but nothing executes due reports), an integrations hub (outbound webhooks +
SCIM provisioning built to contract), and a first honest platform plane (tenant provisioning
and oversight for the operator) — all with zero regression.

## 2. In / out

**In**
- **Analytics engine**: aggregate endpoints + exec dashboard — fleet composition & spend
  (cost-gated), license utilization & expiry runway, procurement cycle times (PR→PO→GRN),
  work-order throughput/aging & SLA-breach rate, health-grade distribution & discovery
  coverage. Pure derivations (buckets, runway, cycle math) live in `packages/domain`.
- **Scheduled-report runner**: an interval job executes due `ScheduledReport`s through the
  existing v1 reports engine, delivers via `MailProvider` (attachment) + in-app notification,
  records `lastRunAt/lastRunStatus` honestly and advances `nextRunAt`. Failures are recorded,
  never silently retried into oblivion. A small web UI to manage saved schedules.
- **Integrations hub**:
  - **Outbound webhooks** — `WebhookSubscription` (url, events, secret); HMAC-SHA256-signed
    deliveries with bounded retry/backoff and a dead-letter status; events chosen from what
    the platform already audits (asset lifecycle, request decisions, seat-limit refusals,
    WO escalations, discovery conflicts).
  - **SCIM 2.0 provisioning** — token-authed `/scim/v2` Users endpoint mapping to
    users + role assignment, **built to contract**: no live IdP exists here, so it ships
    RFC-shaped and integration-tested, stated honestly (the Intune/Entra precedent).
  - SSO status surfaced in the hub (the existing Entra OIDC stays as-is).
- **Platform plane (MSP seed)**: a `platform` module for operator-designated platform
  admins — tenant list with usage stats (users/assets/storage counts), tenant provisioning
  (create company + bootstrap admin), suspend/activate. Cross-tenant reads happen ONLY
  through this module's explicit platform scope; tenant-plane behaviour is untouched.
- Web UIs for all of the above; a mobile analytics summary screen (both-sides policy).

**Out (honestly):** billing/subscription management; HRIS/ERP connectors; live IdP
verification of SCIM (no tenant); MSP impersonation (QA already N/A); `companyId→tenantId`
rename (open decision #1 — still deferred, alias only); predictive/ML analytics; SCIM Groups
beyond role mapping.

## 3. Invariants

1. **Analytics never leaks cost** — every spend figure sits behind `assets:cost:read`,
   enforced server-side per aggregate, not by hiding UI.
2. **The runner is idempotent and honest** — a due report runs once per due tick;
   failure lands in `lastRunStatus` and notifies the owner; no fabricated success.
3. **Webhook deliveries are signed and bounded** — HMAC over the raw body, capped retries,
   dead-letter visible in the hub; a dead endpoint never wedges the queue.
4. **The platform plane is additive** — tenant users see zero behavioural change; platform
   endpoints require the platform-admin gate AND are audited; no ambient cross-tenant reads.
5. **SCIM writes obey the same guards as the UI** — role mapping goes through the existing
   role-assignment path (SoD warnings included), never raw inserts.

## 4. Permissions

New keys: `analytics:read` (exec dashboard; spend figures still need `assets:cost:read`),
`integrations:manage` (hub + webhooks + SCIM token), `platform:tenants:manage`
(platform plane; granted to no tenant role — operator-designated only).
Matrix: SUPER_ADMIN + FINANCE + AUDITOR get `analytics:read` (auditor read-only invariant
holds); SUPER_ADMIN gets `integrations:manage`. Seed re-run required locally + prod.

## 5. Workstreams

| WS | Scope |
|---|---|
| **A1 Analytics API** | `packages/domain/analytics.ts` (pure bucket/runway/cycle math) + `apps/api/src/analytics/` aggregates w/ date ranges; cost-gated |
| **A2 Report runner** | Interval job: due schedules → v1 report engine → MailProvider attachment + notification → honest status; schedules web UI |
| **A3 Integrations API** | Webhooks (subscription CRUD, signed delivery, retry/dead-letter) + SCIM 2.0 Users built-to-contract + hub read model |
| **A4 Platform plane API** | Platform-admin gate, tenant provisioning/suspend/activate, usage stats, audited cross-tenant reads |
| **A5 Web** | /analytics dashboard (Recharts), /settings/integrations, /settings/schedules, /platform/tenants |
| **A6 Mobile** | Analytics summary screen (KPIs, no cost without permission), More entry |
| **A7 Jobs + QA** | Runner + webhook-retry timers consolidated; QA `NFR-*`/`AUD-*`/`TEN-*` scorecard w/ honest N/A; docs |

Sequencing: A1 → A2/A3/A4 (parallel) → A5/A6 → A7. Cadence: small PRs into `v2.6`, one
integration PR.

## 6. Acceptance criteria (traced)

1. Exec dashboard renders real aggregates per role; spend hidden without cost permission
   (server-asserted), matching `NFR`/`RBAC` expectations.
2. A due scheduled report is generated, mailed (local `.eml` in dev), and stamped; a failing
   report records FAILURE and notifies — proven by integration tests (AUD-adjacent).
3. Webhook delivery carries a verifiable HMAC signature; a dead endpoint retries N times then
   dead-letters without blocking others.
4. SCIM create/update/deactivate round-trips against the RFC shapes in integration tests;
   role mapping goes through the guarded path.
5. Tenant provisioning creates an isolated company + bootstrap admin; suspended tenants
   cannot log in; platform actions audited (`TEN-014`-adjacent).
6. Zero regression: full suite green (729 baseline + new); live web demo; deploy checklist
   (containers + **seed re-run** + APK + outside-in).

## 7. Risks

- **Scope gravity on the MSP plane** — billing and impersonation stay out; this release
  ships provisioning + oversight only.
- **No live IdP/receiver** for SCIM/webhooks — built to contract with signed-request tests;
  stated honestly everywhere (the established precedent).
- **Aggregate cost** — analytics queries are read-heavy; cache with the existing
  CacheProvider (short TTL) and index where the planner says so, not speculatively.
- **Estimate**: comparable to v2.5 (~7 PRs).

## 8. Phase gate

Standard: typecheck 9/9, full suites green, lint clean, QA scorecard on the epic, live demo,
then **STOP for explicit approval before deploy** (containers + seed re-run + APK rebuild +
outside-in verification).
