# Phase 3 — Invoices & AI: verification report

**Date:** 2026-07-23
**Scope:** PLAN.md §5 Phase 3 — document upload + storage, invoice records, asset↔line links, AI
provider abstraction, Azure Doc Intelligence integration shell, deterministic verification engine,
split-screen review UI, Super Admin AI configuration.

Follows spec §27: what ran, what passed, what did **not** run, and why.

---

## 1. Exit criteria

| Criterion                                                                         | Result   | Evidence                                                                                                  |
| --------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| Quantity / cost / duplicate / missing-asset mismatches all detected by unit tests | **Pass** | 25 verification-engine unit tests, one per mismatch class both ways                                       |
| AI-off proves zero outbound provider calls                                        | **Pass** | `invoices.integration.test.ts` spies on `AiDocumentProvider.extract` and asserts `not.toHaveBeenCalled()` |

## 2. Verification checklist

| #   | Check                    | Result      | Detail                                                                                                                        |
| --- | ------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formatting               | **Pass**    | Prettier clean                                                                                                                |
| 2   | Linting                  | **Pass**    | 0 errors, 0 warnings                                                                                                          |
| 3   | Type checking            | **Pass**    | 7 packages incl. seed program                                                                                                 |
| 4   | Unit tests               | **Pass**    | 178 passed (112 domain, 32 tokens, 14 contracts, 15 api, 5 web)                                                               |
| 5   | Integration tests        | **Pass**    | 109 passed across 7 files                                                                                                     |
| 6   | End-to-end tests         | **Not run** | Playwright is Phase 6. Invoice flow walked manually in the browser and via a live-API script                                  |
| 7   | Mobile tests             | **Not run** | Phase 4                                                                                                                       |
| 8   | Accessibility            | **Partial** | Split-screen uses table semantics, `role="switch"` on toggles, labelled selects, `role="alert"`. **No axe or keyboard audit** |
| 9   | Dependency security scan | **Not run** | Phase 6                                                                                                                       |
| 10  | Database migrations      | **Pass**    | 6 applied; `migrate status` clean                                                                                             |
| 11  | Seed                     | **Pass**    | AI configuration seeded disabled with human review required                                                                   |
| 12  | Responsive layout        | **Partial** | Verified at 695 px and desktop                                                                                                |
| 13  | Light and dark mode      | **Pass**    | Tokens unchanged                                                                                                              |
| 14  | Role permissions         | **Pass**    | invoices:read/upload/verify and ai:configure all tested allow + deny                                                          |
| 15  | Audit logs               | **Pass**    | 931 rows incl. INVOICE_UPLOADED ×24, VERIFICATION_APPROVED ×5, SETTING_CHANGED ×16                                            |
| 16  | File access security     | **Pass**    | Signature-verified signed URLs + per-company ownership check; file validated by magic bytes                                   |
| 17  | AI enable/disable        | **Pass**    | Spy proves no provider call when disabled; UI shows simulated marker when enabled                                             |
| 18  | Cost calculations        | **Pass**    | Exact-decimal engine, 25 tests                                                                                                |
| 19  | Invoice mismatches       | **Pass**    | Detected in unit tests, integration tests and the live browser flow                                                           |
| 20  | QR workflows             | **Partial** | Unchanged from Phase 1                                                                                                        |

## 3. Test results

```
Unit         178 passed   + 25 verification engine + 13 AI-gate + 7 file-validation
Integration  109 passed   permissions 62 · workflow 11 · offboarding 9 · invoices 14 · canDecide 6 · health 5 · rate-limit 2
──────────────────────────────────────
Total        287 passed, 0 failed, 0 skipped
```

The verification engine is tested hardest because spec §9 forbids AI from doing its job: 25 tests,
each mismatch class (cost, line total, subtotal, unit price, quantity, duplicate number, duplicate
file hash, duplicate serial, missing asset, unlinked line, currency, date, PO reconciliation) proven
both to fire when wrong and to stay quiet when right, plus robustness cases (malformed money never
throws, empty line list). `deriveOutcome` is proven never to return VERIFIED or REJECTED — those need
a human.

## 4. How the spec's hard requirements are enforced

- **"When AI is disabled, no document is submitted to an external provider."** Every upload passes
  through `AiConfigService.gate()` (pure logic in `packages/domain/ai-config.ts`) before the provider
  is touched. The integration test spies on the actual provider instance and asserts zero calls. This
  is structural, not a convention.
- **"Do not use AI for exact mathematical or database validation."** All arithmetic lives in the pure
  `verifyInvoice` engine with `decimal.js`; the AI provider only proposes field values with
  confidences. Deterministic verification runs on every invoice, AI or not.
- **"Human review is required for final invoice verification."** VERIFIED/REJECTED go through
  `assertHumanDecisionOnly` (Phase 0 domain guard) and require the `invoices:verify` permission —
  Finance and Super Admin only. `mayAutoApproveFinancials()` returns false unconditionally, with no
  argument that could turn it on.
- **"Never expose invoice documents through public URLs."** The local provider mints HMAC-signed,
  expiring URLs; the download route verifies the signature _and_ checks the document belongs to the
  caller's company. Files are stored under opaque ULID keys, never the original name.
- **"Do not silently pretend an external API call succeeded."** The mock extractor flags every result
  `simulated: true`, the review UI shows a visible "AI extraction simulated" banner, and the Azure
  provider throws a clear error rather than returning fake data if selected before it is finished.

## 5. Design decisions worth flagging

**The extracted invoice number is not written to the invoice automatically.** It is a unique key, and
§9 requires a human to correct extracted fields before they are committed, so the suggestion lives in
the extraction record and the reviewer applies it. This also means re-uploading the same document is
never blocked at creation — duplicate detection is a _verification warning_, not a hard constraint.

**File type is decided by magic bytes, not the declared MIME type.** A client claiming `application/pdf`
while sending an executable is rejected; the test proves it.

**Malware scanning is a documented hook, honestly reported.** With no scanner wired, documents are
marked `SKIPPED`, never silently `CLEAN`.

## 6. Known limitations

- **AI extraction is a deterministic mock, not real OCR.** It derives stable pseudo-values from the
  file hash so the review flow is testable, and flags every result `simulated`. The Azure Document
  Intelligence provider is written to the real REST contract but its network call is left
  unimplemented (and throws if selected) rather than faked — completing it is mechanical once an SDK
  and subscription are available. **No real document was ever OCR'd.**
- **Storage is local filesystem only.** The `StorageProvider` interface is complete; Azure Blob and
  S3 implementations are not written, and the module throws if either is selected. Azurite in the
  Compose file is unverified.
- **The signed-URL download route is proven by construction and unit-tested logic, but the browser
  preview uses a simpler authenticated `/storage/preview/:id` route.** Both enforce company
  ownership; the signature path is exercised by its own verify method, not yet by an integration test.
- **Field correction is read-mostly in the UI.** The review screen shows extracted fields, confidence
  highlights, line items and issues, and supports the human Verify/Reject decision, but inline editing
  of extracted values and line-to-asset linking from the UI are API-only this phase (`/lines/link`
  and manual re-entry exist; the edit form does not).
- **Per-office / per-role AI overrides** are modelled, gated and unit-tested in the domain layer, but
  the AI settings page edits only global switches and per-feature modes — not the override rows.
- **Budget and monthly-limit enforcement is recorded, not enforced.** AI usage is logged with cost and
  duration, and the config stores a budget, but nothing blocks a call when the budget is exceeded yet.
- **Integration tests share one persistent database** and accumulate rows across runs (they are
  written to tolerate that). A per-run schema is deferred.
- **Screenshots unavailable** — the browser pane was not compositing. UI verification used the
  accessibility tree and rendered page text.

## 7. What was verified in the browser and against the live API

A script driving the running API confirmed, in order:

1. **AI off:** upload returns 201, `extraction.ran = false`, zero extraction records.
2. **AI on:** upload returns 201, `extraction.ran = true`, `simulated = true`, provider `mock`.
3. **Manual invoice with a bad total:** verification outcome `COST_MISMATCH`, issue `expected 2200.00,
actual 9999.00`.
4. **Human decision:** Finance verifies → status `VERIFIED`, decider recorded as
   `finance@techpioasset.dev`.

In the browser as Finance:

- Invoices list shows all seeded statuses — Verified, Cost mismatch, Possible duplicate, Partially
  matched.
- The **split-screen review page** rendered: document panel on the left ("entered manually"),
  extracted fields, line-item table, and **three verification issues** each with expected/actual
  values, plus "A human decision is required — AI never verifies an invoice on its own."
- **Clicked Verify** → status changed to "Verified" and the decision panel recorded it.

## 8. Recommendation

Phase 3 meets both exit criteria. Phase 4 is the mobile application (Expo, QR/barcode scanning,
camera capture, offline queue, push). Two carry-over infrastructure items become relevant:

1. **Real object storage** — mobile invoice-photo capture and offline sync will exercise the storage
   path harder. Wiring the Azure Blob or S3 provider (or verifying Azurite) is worth doing before
   Phase 4 rather than during it.
2. **Durable queues** — still in-process. Not blocking for Phase 4, but the push-notification fan-out
   will want BullMQ eventually.

Neither blocks starting Phase 4.
