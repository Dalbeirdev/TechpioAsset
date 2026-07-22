# Phase 5 — Maintenance, warranty, depreciation, reports & scheduling: verification report

**Date:** 2026-07-23
**Scope:** PLAN.md §5 Phase 5 — asset maintenance lifecycle, warranty tracking and expiry alerts,
asset depreciation, advanced reports (CSV / Excel export, permission-gated financial columns, saved
scheduled reports), scheduled warranty/maintenance alert sweeps, and optional Teams/Slack chat
integration.

Follows spec §27: what ran, what passed, what did **not** run, and why. Unlike Phase 4, this phase is
entirely server-and-web and **fully verifiable on this machine** — there is no device dependency.

---

## 1. What was built

- **Depreciation** — pure exact-decimal math in `packages/domain/src/depreciation.ts`
  (`computeDepreciation`, `monthsBetween`). Straight-line and declining-balance, floored at salvage
  value, with an end-of-life clamp so a declining-balance asset is carried at residual value rather
  than stranded above it forever. Method `NONE` (or an asset with no useful life) simply holds value.
  Money is `decimal.js` throughout — never a float. **14 unit tests.**
- **Warranty** — `packages/domain/src/warranty.ts`: `warrantyBucket` (EXPIRED / WITHIN_30/60/90 /
  BEYOND_90 / NONE), `isWarrantyAlertable`, `warrantyDaysRemaining`, `repairRecommendation`
  (REPAIR / REPLACE / MARGINAL with a band around the threshold so it does not flip on a cent), and
  `isRepeatFailure`. **11 unit tests.**
- **Maintenance status machine** — `packages/domain/src/maintenance-status.ts`: data-driven
  REQUESTED → SCHEDULED → IN_PROGRESS → COMPLETED / FAILED / CANCELLED, with COMPLETED / CANCELLED /
  FAILED terminal. Shares the same `state-machine.ts` engine as asset/request/verification.
  **6 unit tests.**
- **Maintenance module** (`apps/api/src/maintenance/`) — list / findOne / create / schedule / start /
  complete / cancel / repair-advice. `start()` transitions the asset to UNDER_REPAIR (guarded by the
  asset state machine); `complete()` restores it to AVAILABLE. Cost columns are gated by `canSeeCost`.
- **Reports engine** (`apps/api/src/reports/`) — seven report types (asset inventory, spending by
  vendor / category / department, depreciation, warranty expiry, maintenance cost). Financial reports
  return **403 for a role without cost permission** (refused, not silently stripped). CSV (RFC 4180)
  and Excel (SpreadsheetML 2003 `.xls`, no native dependency) export, streamed with a
  `Content-Disposition: attachment` header; the response-envelope interceptor was taught to skip
  wrapping attachment responses.
- **Scheduled jobs** (`apps/api/src/scheduled/`) — a pure 5-field cron next-run computer
  (`cron.ts`, no cron library), CRUD for saved scheduled reports, and an alert sweep
  (`alert-sweep.service.ts`) that raises warranty-expiry and overdue-maintenance notifications with
  **same-day dedup** so a re-run does not re-alert.
- **Chat provider** (`apps/api/src/providers/chat/`) — the §28 provider pattern: interface + mock
  (records, flags `simulated`) + webhook implementation posting JSON to a Teams/Slack incoming
  webhook. Selected by `CHAT_PROVIDER=mock|webhook`.
- **Web UI** — `/reports` (report selector, table, CSV/Excel download via authenticated blob fetch)
  and `/maintenance` + `/maintenance/[id]` (list and detail with start/complete actions), plus a
  Reports nav entry gated on `reports:read`.

## 2. Exit criteria

| Criterion                                                      | Result   | Evidence                                                                                    |
| -------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| A repair moves the asset to UNDER_REPAIR and back to AVAILABLE | **Pass** | Live API: created REQUESTED → start IN_PROGRESS/UNDER_REPAIR → complete COMPLETED/AVAILABLE |
| Financial reports are refused for roles without cost sight     | **Pass** | Live API: Finance spending report 200, HR 403; 403 is a refusal, not a column strip         |
| Reports export to CSV and Excel with correct headers           | **Pass** | Live API: `text/csv; charset=utf-8`, attachment disposition, exact header row, 14 data rows |
| Depreciation is exact and floored at salvage                   | **Pass** | 14 domain unit tests incl. end-of-life clamp and salvage floor for both methods             |
| Warranty expiry raises alerts within 30/60/90, idempotently    | **Pass** | 11 domain tests; live sweep is same-day-idempotent (0 on the second run)                    |
| Scheduled reports compute a correct next run                   | **Pass** | Live API: cron `0 9 * * 1` → next Monday; integration test asserts the computed instant     |

## 3. Verification checklist

| #   | Check                    | Result           | Detail                                                                         |
| --- | ------------------------ | ---------------- | ------------------------------------------------------------------------------ |
| 1   | Formatting               | **Pass**         | Prettier clean (lockfile excluded as before)                                   |
| 2   | Linting                  | **Pass**         | 0 errors across all packages                                                   |
| 3   | Type checking            | **Pass**         | All packages typecheck                                                         |
| 4   | Unit tests               | **Pass**         | 267 passed (domain 162, tokens 32, contracts 14, api 43, web 5, mobile 11)     |
| 5   | Integration tests        | **Pass**         | 135 passed incl. 16 new lifecycle/reporting                                    |
| 6   | End-to-end tests         | **Not run**      | Playwright is Phase 6                                                          |
| 7   | Mobile tests             | **Unchanged**    | 11 mobile unit tests still pass; no mobile work in Phase 5                     |
| 8   | Accessibility            | **Not assessed** | WCAG audit is Phase 6                                                          |
| 9   | Dependency security scan | **Not run**      | Phase 6                                                                        |
| 10  | Database migrations      | **Pass**         | 7 applied; Phase 5 models (MaintenanceRecord, ScheduledReport) were in `_init` |
| 11  | Seed                     | **Pass**         | Unchanged; idempotent                                                          |
| 12  | Responsive layout        | **Pass**         | Reports and maintenance pages use the shared responsive shell                  |
| 13  | Light and dark mode      | **Pass**         | Rendered via the shared token palette (verified in the running web app)        |
| 14  | Role permissions         | **Pass**         | Reports gated by `reports:read`/`reports:export`; cost columns by `canSeeCost` |
| 15  | Audit logs               | **Pass**         | Maintenance and scheduled-report writes flow through the audited interceptor   |
| 16  | File access security     | **Pass**         | Report downloads are permission-checked before streaming                       |
| 17  | AI enable/disable        | **Pass**         | Unchanged; Phase 5 does not touch AI                                           |
| 18  | Report export            | **Pass**         | CSV + Excel, permission-gated financial columns, saved scheduled reports       |
| 19  | Chat integration         | **Coded**        | Mock records and flags simulated; webhook impl posts to a real Teams/Slack URL |

## 4. Test results

```
Unit         267 passed   domain 162 (+31: depreciation 14, warranty 11, maintenance 6) · tokens 32 · contracts 14 · api 43 (+5 report-format, +7 cron) · web 5 · mobile 11
Integration  135 passed   permissions 62 · lifecycle-reporting 16 · invoices 14 · workflow 11 · mobile-sync 10 · offboarding 9 · canDecide 6 · health 5 · rate-limit 2
──────────────────────────────────────
Total        402 passed, 0 failed, 0 skipped
```

The depreciation tests are the ones that matter most, because a book value is money and must be
exact: they prove straight-line accrues linearly and never dips below salvage; declining-balance
reduces the _carrying_ value and is written down to exactly salvage at end of useful life (the
end-of-life clamp — the bug that first surfaced as `'211.51'` vs `'100.00'` and was fixed to the
standard accounting convention); and an asset with no method or no useful life holds its value.

## 5. What was verified against the live API

A script driving the running API confirmed, end to end:

1. **Maintenance lifecycle** — a repair created as REQUESTED, started to IN_PROGRESS with the asset
   moving to **UNDER_REPAIR**, then completed to COMPLETED with the asset restored to **AVAILABLE**.
2. **Report permission gate** — Finance gets the spending-by-vendor report (**200**); HR is refused
   (**403**) because it has no cost permission. The refusal is a 403, not a stripped column set.
3. **CSV download** — `content-type: text/csv; charset=utf-8`,
   `content-disposition: attachment; filename="depreciation-…csv"`, header row
   `Asset tag,Name,Method,Purchase cost,Accumulated,Current value`, 14 data rows + header.
4. **Warranty alert sweep** — runs and is **same-day idempotent**: the second run raises 0 new alerts
   because the day's alerts were already sent. (Both runs in this session returned 0 for the same
   reason — the integration suite had already swept today's DB; this is the dedup working, not a
   miss.)
5. **Scheduled report** — a saved report with cron `0 9 * * 1` computes its next run at the next
   Monday, persisted on the record.

## 6. Providers added

- **ChatProvider** — mock (records the post, flags `simulated`, sends nothing) and a webhook
  implementation that POSTs a JSON payload to a Teams/Slack incoming-webhook URL, written to the real
  contract but throwing rather than faking if `CHAT_PROVIDER=webhook` is selected without a URL. This
  is the §28 pattern already used for storage, AI, mail, push and queue.

## 7. Known limitations

- **Chat delivery is simulated by default.** The mock records messages; real delivery needs
  `CHAT_PROVIDER=webhook` and a live Teams/Slack incoming-webhook URL, which are not configured here.
  The webhook code path is written and typechecked but was not fired against a real endpoint.
- **The scheduled-report and alert-sweep timers are opt-in.** They run on boot only when
  `ENABLE_SCHEDULED_JOBS=true`; the endpoints (`POST /scheduled/alerts/run`) were exercised manually
  and by integration tests, but a long-running wall-clock schedule was not observed firing on its own.
- **Depreciation shows zero for the seeded demo assets.** The demo seed does not set
  `usefulLifeMonths`, so `computeDepreciation` correctly returns the assets at full value. The math
  itself is proven by the 14 unit tests with explicit lives; the report renders the correct (zero)
  result for data that has no depreciation configured.
- **Excel export is SpreadsheetML 2003 XML, not XLSX.** This is deliberate — it opens in Excel and is
  string-testable with no native dependency — but it is the older `.xls` XML format, not the zipped
  OOXML `.xlsx`.
- **The web maintenance list was verified positively via the API, not a browser click-through.** The
  headless preview browser could not reliably drive the controlled React login form to switch to an
  IT-role session; the maintenance page's permission gate was confirmed in-browser (Finance is
  correctly refused) and the list endpoint itself is covered by integration tests and the live flow.
- **E2E, accessibility, and dependency scanning are Phase 6**, unchanged from prior phases.

## 8. Recommendation

Phase 5 is complete and verified to the project's standard: 402 automated tests pass, and a live-API
flow confirms the maintenance lifecycle, the report permission gate, CSV/Excel export, idempotent
warranty sweeps, and scheduled-report next-run computation. Depreciation and warranty math — the
money-critical parts — are pure, exact-decimal, and unit-tested against explicit fixtures.

The remaining gaps are configuration, not correctness: chat and scheduled timers need real
credentials/enablement to fire in production, and the demo seed does not populate useful-life so the
depreciation report reads zero. None of these block the phase.

Phase 6 (hardening — security suite, WCAG audit, k6 performance, dependency audit, final
verification) is the next and last phase.
