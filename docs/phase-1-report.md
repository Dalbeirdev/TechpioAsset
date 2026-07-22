# Phase 1 — Core: verification report

**Date:** 2026-07-23
**Scope:** PLAN.md §5 Phase 1 — authentication, users and profiles, roles and permissions, org
structure, categories, assets, inventory, assignment and return, role dashboards, app shell and
profile menu.

Follows spec §27: what ran, what passed, what did **not** run, and why.

---

## 1. Exit criteria

| Criterion                                       | Result                     | Evidence                                                                           |
| ----------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| All 8 seeded roles log in                       | **Pass**                   | Integration test + browser; each returns correct roles, scope and permission count |
| Permission matrix verified by integration tests | **Pass**                   | 64 integration tests, every case asserted allow **and** deny                       |
| Employee cannot read another's asset (403)      | **Pass** — returns **404** | Deliberate: see §5                                                                 |

## 2. Verification checklist

| #   | Check                    | Result      | Detail                                                                                                                                                |
| --- | ------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formatting               | **Pass**    | Prettier clean                                                                                                                                        |
| 2   | Linting                  | **Pass**    | 6 packages, 0 errors, 0 warnings                                                                                                                      |
| 3   | Type checking            | **Pass**    | 6 packages incl. seed program                                                                                                                         |
| 4   | Unit tests               | **Pass**    | 128 passed, 0 failed, 0 skipped                                                                                                                       |
| 5   | Integration tests        | **Pass**    | 64 passed against a live PostgreSQL                                                                                                                   |
| 6   | End-to-end tests         | **Not run** | Playwright suite is Phase 6; UI verified manually in-browser                                                                                          |
| 7   | Mobile tests             | **Not run** | Phase 4                                                                                                                                               |
| 8   | Accessibility            | **Partial** | Semantics built in (skip link, aria-current, roles, labelled controls, table caption, focus return, reduced-motion). **No axe or keyboard audit run** |
| 9   | Dependency security scan | **Not run** | Phase 6                                                                                                                                               |
| 10  | Database migrations      | **Pass**    | 2 migrations applied; `migrate status` clean                                                                                                          |
| 11  | Seed                     | **Pass**    | Idempotent; re-run created 0 duplicate assets                                                                                                         |
| 12  | Responsive layout        | **Partial** | Verified at 695 px and desktop. No tablet sweep                                                                                                       |
| 13  | Light and dark mode      | **Pass**    | Both verified                                                                                                                                         |
| 14  | Role permissions         | **Pass**    | 64 integration tests                                                                                                                                  |
| 15  | Audit logs               | **Pass**    | 70 rows: 62 LOGIN, 7 LOGIN_FAILED, 1 LOGOUT, with actor, IP and correlation ID                                                                        |
| 16  | File access security     | **N/A**     | Storage is Phase 3                                                                                                                                    |
| 17  | AI enable/disable        | **N/A**     | Phase 3; seeded off                                                                                                                                   |
| 18  | Cost calculations        | **Pass**    | 17 money unit tests                                                                                                                                   |
| 19  | Invoice mismatches       | **N/A**     | Phase 3                                                                                                                                               |
| 20  | QR workflows             | **Partial** | Opaque ULID token issued per asset and `/assets/by-qr/:token` enforces auth + scope. Scanning is Phase 4                                              |

## 3. Test results

```
Unit          128 passed   domain 55 · ui-tokens 32 · contracts 14 · api 22 · web 5
Integration    64 passed   permissions 62 · rate limiting 2
─────────────────────────────────────────
Total         192 passed, 0 failed, 0 skipped
```

The integration suite boots the **real** application — same module graph, guards and filters as
production. Mocking the guards would have tested the mocks, and the guards are the thing under test.

Assertions worth naming:

- **Both directions, every time.** A suite that only proves allowed roles can act would still pass
  with the guard deleted. Denials are what have teeth.
- **Account enumeration**: an unknown address and a wrong password return identical status _and_
  body.
- **Refresh token** is `HttpOnly` and never appears in a response body.
- **Tampered JWT** (valid header/payload, forged signature) is rejected.
- **Cost redaction** holds on list _and_ detail endpoints, for HR, Manager and Employee.
- **Rate limiting** returns a catalogued `RATE_LIMITED` problem document after the configured limit.

## 4. Security defects found and fixed

**A real authorization bypass, caught by an integration test.** Asset list filters were merged into
the scope filter with object spread:

```ts
const where = { ...assetScopeFilter(actor), ...(query.assignedUserId ? {...} : {}) };
```

Later keys win in a spread, so `?assignedUserId=<another user>` **overwrote** the employee scope's own
`assignedUserId` and returned another employee's assets. Scope and caller filters are now composed
with `AND`, which cannot be overridden by construction. The regression test is
_"cannot be bypassed by filtering for another user's assets"_.

This is the exact failure the spec's §26 security tests target, and it was invisible to the
happy-path checks — the employee's own list looked correct throughout.

Also fixed:

- **Validation errors returned 500 instead of 422.** `instanceof ZodError` fails when the contracts
  package and the API resolve separate copies of Zod. Now a structural check, which survives
  duplicate copies and version differences.
- **`PrismaService.onModuleInit` crashed the process** when Postgres was unavailable, taking
  `/health/ready` down with it — the endpoint whose job is to report that outage. Now degrades.

## 5. Design decisions worth flagging

**Employee isolation returns 404, not 403.** The exit criterion says 403. A 403 confirms a record
exists at that id, which is precisely the insecure-direct-object-reference leak §26 asks us to
prevent. 404 is the stronger answer and what the tests assert. Flagging it because it deviates from
the letter of the criterion while serving its intent.

**Permissions are re-resolved from the database on every request**, not trusted from JWT claims. The
token identifies the subject; authority always comes from current state. A revoked role therefore
takes effect immediately rather than at token expiry.

**Cost columns are omitted from the SQL query**, not filtered from the result. A value the caller may
not see never leaves the database.

**Audit failures are logged, never thrown.** A full audit table would otherwise lock users out of
logging in. The trade is deliberate: gaps are made loud rather than allowed to take the system down.

## 6. Known limitations

- **Email delivery does not exist.** Password reset and email verification generate real, hashed,
  single-use tokens, but there is no mail provider until Phase 2. Outside production the token is
  returned in the response body so the flow is testable; in production it is withheld and the reset
  email is simply never sent. **Password reset is therefore not usable end-to-end yet.**
- **MFA is implemented but unproven end-to-end.** Enrolment, encrypted-at-rest secrets, TOTP
  verification and the login challenge are all built, and no demo account has it enabled, so the
  challenge path has not been exercised against a real authenticator app.
- **No write endpoints for org structure or categories.** Offices, departments, rooms and categories
  are read-only in the API; the seeded structure covers Phase 1. Admin CRUD screens are not built.
- **Inventory has no endpoints.** The model, ledger and seed data exist; issue/adjust operations are
  not exposed.
- **Avatar upload is not implemented.** The profile menu renders initials and a generic icon
  fallback; `avatarKey` has no upload path until storage lands in Phase 3.
- **Dashboards are one shared, scope-aware view**, not the six distinct role dashboards of spec §17.
  Each role sees correctly filtered figures, but the HR/IT/Finance/Office-specific tiles are not
  built.
- **Requests, onboarding and notifications are Phase 2** and absent. The nav links to `/my-requests`,
  `/people`, `/maintenance` and `/help` resolve to 404s.
- **Redis is still unavailable.** Rate limiting uses in-memory storage, which does not share counters
  across instances. Reported as non-critical until Phase 2.
- **Screenshots could not be captured** this session (the browser pane was not compositing). UI
  verification used the accessibility tree and rendered page text, which is stronger evidence for the
  scope assertions but weaker for visual polish.
- **`embedded-postgres` is pinned to a beta** (18.4.0-beta.17) — the only published release. It is a
  `devDependency`, never loaded by the application, and Compose remains the primary path.

## 7. What was verified in the browser

Signed in as `employee@techpioasset.dev`:

- Dashboard: "Welcome back, Ravi", **3 assets**, "Assets assigned to you", one warranty expiring in
  18 days — matching the seed exactly.
- Assets table: 3 rows, **no Cost column**.
- Profile menu: name, email, role badge, department · office, six items plus Sign out.
- Sign out cleared the session and redirected to the sign-in screen.

Then as `admin@techpioasset.dev` on the same page: **14 assets with a Cost column**. Same code, same
route — the difference is entirely server-enforced.

## 8. Recommendation

Phase 1 meets its exit criteria. Before Phase 2, decide on:

1. **Mail delivery** — Mailpit runs in Compose but Compose is unverified here. Without it, password
   reset stays incomplete and Phase 2's notification work has nothing to deliver into.
2. **Redis** — Phase 2 introduces BullMQ queues, which make it a hard dependency. There is no
   user-space Redis path on Windows, so this likely forces the Docker decision.
