# Phase 2 — Requests: verification report

**Date:** 2026-07-23
**Scope:** PLAN.md §5 Phase 2 — request module, configurable approval workflows, approvals,
onboarding/offboarding with completion gate, notifications (in-app, email, preferences).

Follows spec §27: what ran, what passed, what did **not** run, and why.

---

## 1. Exit criteria

| Criterion                                                                                      | Result   | Evidence                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| Laptop request traverses Employee → Manager → HR → IT → Finance → assigned → receipt-confirmed | **Pass** | `workflow.integration.test.ts`, single end-to-end test driving the real HTTP API as each actor |
| Offboarding blocked while an asset is unresolved                                               | **Pass** | `offboarding.integration.test.ts`, 409 naming the blocking asset tags                          |

## 2. Verification checklist

| #   | Check                    | Result      | Detail                                                                                                                                                                      |
| --- | ------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formatting               | **Pass**    | Prettier clean                                                                                                                                                              |
| 2   | Linting                  | **Pass**    | 0 errors, 0 warnings                                                                                                                                                        |
| 3   | Type checking            | **Pass**    | 6 packages incl. seed program                                                                                                                                               |
| 4   | Unit tests               | **Pass**    | 147 passed (74 domain, 32 tokens, 14 contracts, 22 api, 5 web)                                                                                                              |
| 5   | Integration tests        | **Pass**    | 95 passed across 6 files                                                                                                                                                    |
| 6   | End-to-end tests         | **Not run** | Playwright is Phase 6. The workflow _is_ covered end-to-end at the API layer and walked manually in the browser                                                             |
| 7   | Mobile tests             | **Not run** | Phase 4                                                                                                                                                                     |
| 8   | Accessibility            | **Partial** | Semantics carried through new screens (radiogroup filter, fieldset/legend per item, `role="alert"`, labelled controls, ordered approval list). **No axe or keyboard audit** |
| 9   | Dependency security scan | **Not run** | Phase 6                                                                                                                                                                     |
| 10  | Database migrations      | **Pass**    | 5 applied; `migrate status` clean                                                                                                                                           |
| 11  | Seed                     | **Pass**    | Idempotent; adds 5 workflow definitions (13 steps) and an onboarding template                                                                                               |
| 12  | Responsive layout        | **Partial** | Verified at 695 px and desktop                                                                                                                                              |
| 13  | Light and dark mode      | **Pass**    | Tokens unchanged; both schemes verified in Phase 0/1                                                                                                                        |
| 14  | Role permissions         | **Pass**    | 62 permission tests still green, plus step-level authorisation                                                                                                              |
| 15  | Audit logs               | **Pass**    | 591 rows; REQUEST_SUBMITTED ×76, REQUEST_APPROVED ×52, REQUEST_REJECTED ×11, PASSWORD_RESET ×2                                                                              |
| 16  | File access security     | **N/A**     | Storage is Phase 3                                                                                                                                                          |
| 17  | AI enable/disable        | **N/A**     | Phase 3; seeded off                                                                                                                                                         |
| 18  | Cost calculations        | **Pass**    | Threshold arithmetic unit-tested, incl. unknown-cost handling                                                                                                               |
| 19  | Invoice mismatches       | **N/A**     | Phase 3                                                                                                                                                                     |
| 20  | QR workflows             | **Partial** | Unchanged from Phase 1                                                                                                                                                      |

## 3. Test results

```
Unit         147 passed   + 19 new workflow-rule tests
Integration   95 passed   permissions 62 · workflow 11 · offboarding 9 · canDecide 6 · health 5 · rate-limit 2
──────────────────────────────────────
Total        242 passed, 0 failed, 0 skipped
```

## 4. The Redis question, answered

Phase 1 closed by warning that BullMQ would make Redis a hard dependency and force the Docker
decision. On investigation it does not: `redis-memory-server` builds Redis from source and has no
Windows target, so there is no user-space path — but the spec's own §28 pattern applies. Background
jobs now sit behind a `QueueProvider` interface with two implementations:

- **`in-process`** (default) — runs handlers off the request path with the same retry and
  exponential backoff as BullMQ. Not durable across restarts, does not distribute across instances.
- **`bullmq`** — the real durable queue on `REDIS_URL`, selected by `QUEUE_PROVIDER=bullmq`.

Handlers are written once against the shared contract. `/health/ready` reports which is active. The
limitation is real and stated rather than hidden: **an in-process job queued when the API stops is
lost.** For Phase 2's notification fan-out that is acceptable; it would not be for invoice processing
in Phase 3.

## 5. Phase 1 limitations now closed

- **Password reset works end to end.** Verified in full: request → `.eml` written to `.local-mail`
  with a working reset link → token accepted → old password rejected (401) → new password accepted
  (200) → replayed token rejected (422). Delivery goes through `MailProvider`, so switching to real
  SMTP is one environment variable.
- **Requests, approvals and notifications exist**, so `/requests` is no longer a dead nav link.

## 6. Defects found and fixed

Three of these were found by tests that asserted the _negative_ case.

1. **Every future approver saw a request the moment it was submitted.** All approval rows were
   created `PENDING`, so an "awaiting my decision" query matched HR, IT and Finance while the request
   still sat with the manager. Fixed by adding a `WAITING` state: exactly one step is `PENDING` at a
   time, and approving promotes the next. This is a model change, not a query patch — the inbox
   filter was correct; the data was lying to it.
2. **Line-manager approvals never appeared in any inbox.** A `LINE_MANAGER` step carries neither an
   `approverId` nor an `approverRoleId` — the approver is derived from the requester — so the filter
   matched nothing and those requests silently stalled. Now matched through the request's
   denormalised `managerId`.
3. **The UI offered an Approve button that would 403.** Whether a user may act depends on the step's
   approver rules, which the client cannot evaluate. The API now returns a server-resolved
   `canDecide`; six tests pin it, including that a Super Admin holding every permission still cannot
   act on a line-manager step.
4. **`cancel()` accepted a `reason` and discarded it** — the only record of why an in-flight request
   stopped. Now written to the audit trail.
5. **A Postgres migration failure worth remembering:** an enum value cannot be added and used as a
   column default in one transaction. Prisma wraps each migration in one, so the change had to be
   split across two migrations.

## 7. Design decisions worth flagging

**The approval chain is materialised at submit, not read live.** An administrator reordering a
workflow cannot retroactively change approvals an in-flight request has already collected.

**An unknown cost never skips a threshold step.** If the estimate is absent, the request goes to a
human rather than bypassing finance on a technicality.

**A line-manager step requires the actual line manager**, not anyone holding a manager role —
otherwise any manager could approve any request.

**Mandatory notifications cannot be switched off.** `APPROVAL_REQUIRED`, `ASSET_ASSIGNED`,
`RETURN_REQUIRED`, `SECURITY_ALERT` and others ignore stored preferences, because a muted approval
request silently stalls everyone else's work.

**Internal comments are filtered in the query**, not hidden in the UI, so the requester's payload
never contains the reviewers' private discussion.

## 8. Known limitations

- **In-process jobs are not durable.** See §4. Set `QUEUE_PROVIDER=bullmq` with Redis for anything
  real.
- **Email is still simulated by default.** Messages are written to `.local-mail` as `.eml` files and
  every response carries `simulated: true`. Real delivery needs `MAIL_PROVIDER=smtp` and an SMTP
  host, neither verified here.
- **No push, Teams or Slack delivery.** The catalogue models the channels; only in-app and email are
  implemented.
- **Fulfilment is manual.** `advance` moves a request through `INVENTORY_RESERVED` →
  `READY_FOR_ASSIGNMENT` → `ASSIGNED` → `COMPLETED`, but nothing links a request item to the asset
  that satisfied it automatically — an operator assigns the asset separately. `RequestItem.fulfilledAssetId`
  exists and is unused.
- **Onboarding is a checklist, not a driver.** Starting onboarding from a template records the
  required items; it does not raise the equipment requests for them.
- **No workflow administration UI.** Definitions and steps are seeded and editable only in the
  database, though the engine reads them at runtime as §11 requires.
- **No notification preferences screen.** The API serves and updates preferences, with mandatory
  types locked; nothing in the web app calls it yet.
- **Offboarding has no UI.** The gate is enforced and tested at the API; HR would drive it with an
  HTTP client today.
- **Integration tests share one database and accumulate rows.** They are written to be re-runnable
  (creating their own assets, tolerating 409 on repeat onboarding), but they do not reset state, so
  counts grow across runs. A per-run schema would be better and is deferred.
- **Screenshots still unavailable** — the browser pane was not compositing. UI verification used the
  accessibility tree and rendered page text.

## 9. What was verified in the browser

Signed in as `manager@techpioasset.dev`:

- Dashboard scoped to DIRECT_REPORTS — 12 assets, "Assets held by you and your direct reports".
- **Approvals inbox: 27 of 90 requests**, every one at "Manager approval".
- Request detail showed the chain as _Manager review — Awaiting decision_, then _HR confirmation_,
  _IT review_, _Finance approval_ all "Queued" — the WAITING/PENDING distinction rendering exactly as
  modelled.
- Internal comment visible with an "Internal" badge (the requester does not receive it).
- **Clicked Approve**: status moved to "HR review", the chain updated to _Manager review — Approved
  by Daniel Whyte_ and _HR confirmation — Awaiting decision_.

## 10. Recommendation

Phase 2 meets its exit criteria. Phase 3 (invoices and AI) is where the deferred infrastructure
starts to matter for real:

1. **Durable queues become important.** Invoice extraction is slow, external and costly; losing a job
   on restart means a document silently never processed. Recommend Docker (or a managed Redis) before
   Phase 3 rather than during it.
2. **Object storage is required and has no local fallback in place.** Azurite is in the Compose file
   but unverified. The storage provider interface exists; the local implementation does not.
3. **Azure Document Intelligence credentials** — absent them Phase 3 ships against the mock, which
   means the deterministic verification engine can be proven but the extraction path cannot.
