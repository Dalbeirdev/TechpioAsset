# v2.8 — Operational Resilience & Observability

> **Status:** Proposed — awaiting approval before build.
> **Baseline:** prod at `436930f` (v2.7) with RLS enforcement live; 810 tests green.
> **Evidence base:** the v2.7 restore drill and the
> [2026-08-03 RLS switch incident](./incident-2026-08-03-rls-switch.md) — this plan is
> written from what actually went wrong and what the drill actually found, not from a
> wishlist.

## 1. Goal

v2.7 proved the backups restore. It also showed that **every backup lives on the same
machine as the database it protects** — a host loss loses the data and the recovery
material together. And the incident showed that a risky change reached production behind a
verification that could not fail, with no automated preflight to catch it.

v2.8 fixes the operational layer: get the data off the box, make the drill run itself and
complain when it fails, make risky deploys check their own work, and make the next incident
diagnosable instead of archaeological.

## 2. In / out

**In**
- **Off-site backups** (the flagship): the nightly dump is uploaded to object storage
  through the existing provider abstraction (S3-compatible or Azure Blob — both already
  implemented for attachments), with a retention policy, an upload-verified check, and an
  honest local-only fallback when no destination is configured. **No credentials exist in
  this environment**, so the connector ships built-to-contract and verified against a local
  S3-compatible endpoint, stated plainly (the Intune/SCIM precedent).
- **Scheduled drill + alerting**: `restore-db.sh` runs monthly by cron; success and failure
  are recorded, and a failure raises a notification (mail provider) rather than a silent log
  line. A drill that nobody reads is a drill that has not run.
- **Deploy preflight** (`deploy/preflight.sh`): the incident lesson made reusable —
  verify a credential over the path the application actually uses (never a `trust`-shortcut
  path), confirm the migrate/serve URL split resolves, check container health after a
  change and roll back automatically on failure. The v2.7 rollout scripts become one
  reviewed tool instead of three ad-hoc ones.
- **OpenTelemetry tracing**: spans for HTTP requests, Prisma queries and the background
  sweeps, exported OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set and disabled otherwise;
  the existing correlation id becomes the trace id so logs and traces line up.
- **Per-tenant rate-limit buckets**: today's throttle is global, so one noisy tenant can
  degrade the rest — a real concern now that tenant provisioning exists. Keyed per tenant
  with the existing Redis storage.
- **Health endpoint honesty**: `/health/ready` reports RLS enforcement state and backup
  freshness (last successful dump age), so "is it protected?" is answerable from outside.

**Out (honestly):** PITR / WAL archiving (a bigger change than one release), DR failover to
a second region, load-testing rigs, hash-chained audit, e-signatures, RFQ/budgets/vendor
portal, billing, live IdP verification, the `companyId → tenantId` rename.

## 3. Invariants

1. **Off-site upload never blocks the backup.** A failed upload leaves the local dump
   intact and raises an alert; it must not turn a successful backup into no backup.
2. **A drill failure is loud.** Silent success is fine; silent failure is not.
3. **Preflight refuses rather than proceeds.** Any check that cannot prove its claim fails
   the deploy — no "probably fine" paths, which is precisely how the incident happened.
4. **Tracing is off by default and costs nothing when off** — no exporter, no spans, no
   overhead; the same opt-in discipline as every other provider.
5. **Rate-limit isolation is provable**: one tenant saturating its bucket must not raise
   another tenant's error rate — asserted, not assumed.

## 4. Permissions

No new keys (a second release running). Health-endpoint additions are unauthenticated but
carry no tenant data — only booleans and an age in hours.

## 5. Workstreams

| WS | Scope |
|---|---|
| **S1 Off-site backups** | Upload step in `backup-db.sh` via the storage provider, retention + verification, honest local-only fallback, docs; verified against a local S3-compatible endpoint |
| **S2 Scheduled drill + alerting** | Monthly cron, recorded outcomes, failure notification through MailProvider, runbook update |
| **S3 Deploy preflight** | `deploy/preflight.sh`: real-path credential check, URL-split resolution, health gate with auto-rollback; the v2.7 rollout scripts folded in and reviewed |
| **S4 OpenTelemetry** | OTLP-gated tracing for HTTP/Prisma/sweeps, correlation id as trace id, off by default |
| **S5 Per-tenant rate limits** | Tenant-keyed throttler storage + an isolation test (one tenant saturating does not affect another) |
| **S6 Health honesty + QA close-out** | RLS state and backup-freshness in `/health/ready`; QA scorecard; docs |

Sequencing: S1 → S2 (depends on S1) ∥ S3 ∥ S4 ∥ S5 → S6.

## 6. Acceptance criteria

1. A nightly backup lands off-site and its presence is verified; with no destination
   configured the behaviour is today's, with the limitation stated in the health payload.
2. A deliberately corrupted dump makes the scheduled drill fail **and** notify.
3. `preflight.sh` refuses a switch when the credential is wrong on the real auth path —
   proven by re-running the incident's exact scenario against a scratch role.
4. With an OTLP endpoint set, a request produces a trace whose id matches its log
   correlation id; with none set, no exporter is constructed.
5. One tenant exhausting its rate limit leaves another tenant's requests unaffected.
6. Zero regression (810 baseline + new); QA scorecard; deploy checklist.

## 7. Risks

- **No cloud credentials here.** S1 ships built-to-contract, verified against a local
  S3-compatible endpoint (MinIO in the test lane), and says so — the same honesty as the
  Intune connector and SCIM.
- **Tracing overhead**: mitigated by being strictly opt-in and sampling-configurable.
- **Estimate**: comparable to v2.7 (~6 PRs).

## 8. Phase gate

Standard: typecheck, full suites green (both lanes), lint clean, QA scorecard on the epic,
live verification, then **STOP for explicit approval before deploy**.
