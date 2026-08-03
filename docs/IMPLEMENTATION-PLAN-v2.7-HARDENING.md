# v2.7 — Trust Hardening & License Completion

> **Status:** Proposed — awaiting approval before build.
> **Position:** the first post-roadmap release. The mapped plan (v2.1–v2.6) shipped on
> 2026-08-03; this release pays down the gaps those releases recorded honestly instead of
> hiding, and completes the flagship license module.
> **Baseline:** prod at `b785631` (v2.6), 453u+314i tests green.

## 1. Goal

Every QA scorecard since v2.3 has carried the same recorded gaps. v2.7 closes the ones that
matter most for trust — RLS actually enforcing, exports leaving an audit trail, a rehearsed
restore — and finishes what the license module deliberately deferred (bulk operations,
transfers, reclamation). Plus two small completeness items exposed by v2.5/v2.6: a web UI
for preventive maintenance schedules, and approval-workflow seeding for provisioned tenants
(today a fresh tenant's requests warn "No workflow definition" and skip approval).

## 2. In / out

**In**
- **RLS enforcement end-to-end** (staged since v2.1, the oldest honest gap): the
  non-superuser application DB role, per-request `SET app.tenant_id` GUC wiring (the
  interceptor exists), an RLS-on integration lane in the suite proving cross-tenant reads
  die at the database even if an app-layer filter is buggy, and a documented prod rollout
  (env→verify→enforce). The platform plane keeps working via a documented GUC-less path.
- **Audit completeness**: report downloads and scheduled-report sends audit-logged
  (AUD-009); license-key reveals already are — extend the same discipline to CSV/Excel
  export endpoints.
- **License completion** (the deferred third of the flagship): bulk assign/revoke,
  seat transfer between principals, a reclamation flow (flag inactive holders → revoke
  with reason), the 7-day expiry reminder bucket, and the seat-limit dashboard widget.
- **Preventive-schedules web UI**: list/create/pause schedules on the maintenance page
  (the v2.5 API shipped without a surface).
- **Tenant provisioning completeness**: provisioned tenants get the standard workflow
  set seeded (same definitions as the seed), so approvals work from day one.
- **Restore rehearsal**: a scripted, documented restore drill (`deploy/restore-db.sh`)
  executed against a scratch database on the VPS with row-count verification — proof the
  backups actually restore, recorded in the runbook.

**Out (honestly):** load rig / 2M-asset performance runs, DR region, OpenTelemetry,
per-tenant rate buckets, hash-chained audit, e-signatures, RFQ/budgets/vendor portal,
billing/impersonation, live Intune/IdP verification (still no tenant), the
`companyId→tenantId` rename.

## 3. Invariants

1. **RLS enforcement changes no behaviour for correct code** — it is a backstop; the
   proof is a deliberately unfiltered query dying at the database, not app features changing.
2. **Every export leaves a trail** — who, what report, which format, when.
3. **Bulk license operations are transactional per seat** — a bulk assign that hits the
   seat limit takes exactly the seats that fit and reports the refusals honestly, or (caller's
   choice) takes none; never a silent partial success.
4. **Transfers never create seats** — a transfer is revoke+assign in one transaction; the
   pool count is provably unchanged.
5. **A restore drill never touches the live database** — scratch-target only, verified by
   counts, then dropped.

## 4. Permissions

No new keys. Bulk/transfer/reclaim reuse `licenses:assign`/`licenses:revoke`; exports keep
`reports:export`; RLS is infrastructure. (No seed re-run needed at deploy — a first.)

## 5. Workstreams

| WS | Scope |
|---|---|
| **R1 RLS enforcement** | App DB role (non-superuser), GUC wiring verification, RLS-on integration lane, prod rollout doc; platform-plane GUC-less path documented |
| **R2 Export audit** | REPORT_EXPORTED audit action; manual downloads + scheduled sends logged w/ type/format; surfaced in the audit log UI filters |
| **R3 License bulk + transfers** | Bulk assign/revoke (all-or-nothing flag, honest per-seat refusal report), seat transfer (one tx, pool-count invariant pinned) |
| **R4 License reclamation + reminders** | Inactive-holder detection (deactivated users w/ active seats), reclaim flow w/ reason, 7-day expiry bucket, seat-limit dashboard widget |
| **R5 Completeness UIs** | Preventive-schedules web UI (maintenance page); provisioning seeds the standard workflows; web demos |
| **R6 Restore drill + QA close-out** | deploy/restore-db.sh + runbook + executed drill on the VPS (scratch DB, verified, dropped); QA scorecard w/ honest N/A; docs |

Sequencing: R1 ∥ R2 → R3 → R4 → R5 → R6. Cadence: small PRs into `v2.7`, one integration PR.

## 6. Acceptance criteria

1. With RLS_ENFORCE on and the non-superuser role, a hand-written unfiltered cross-tenant
   query returns zero foreign rows — proven in the RLS-on lane; the full suite stays green.
2. Downloading or scheduling a report writes an audit row with actor/type/format.
3. Bulk assign of N seats against a pool with M<N free either takes M with a per-seat
   refusal report or takes 0 (all-or-nothing) — both paths integration-proven under
   concurrency; transfer leaves seatsReserved provably unchanged.
4. A deactivated user's seats appear in reclamation; reclaiming frees the pool and audits.
5. A provisioned tenant submits a request and gets the standard approval chain.
6. The restore drill restores yesterday's backup into a scratch DB with matching row
   counts, documented in the runbook.
7. Zero regression (767-test baseline + new); live web demo; deploy checklist (no seed
   re-run this time; APK only if mobile changes).

## 7. Risks

- **RLS rollout is the risky one** — mitigated by the staged path (local lane → prod env
  flag off → canary on → enforce) and by the fact that policies have been installed and
  probe-verified since v2.1.
- **Bulk operations under concurrency** — reuse the proven atomic-conditional seat pattern;
  the storm tests extend, not replace.
- **Estimate**: smaller than v2.5/v2.6 (~6 PRs).

## 8. Phase gate

Standard: typecheck 9/9, full suites green, lint clean, QA scorecard on the epic, live demo,
then **STOP for explicit approval before deploy**.
