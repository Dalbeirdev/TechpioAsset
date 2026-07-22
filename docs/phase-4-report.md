# Phase 4 — Mobile application: verification report

**Date:** 2026-07-23
**Scope:** PLAN.md §5 Phase 4 — Expo mobile app, QR/barcode scanning, camera capture, offline
inventory + sync, push notifications.

Follows spec §27: what ran, what passed, what did **not** run, and why. This phase carries a hard
environment limit that shapes the whole report — read §1 first.

---

## 1. The environment limit, stated up front

**This is a Windows machine with no Android SDK, no emulator, no `adb`, no Java, and Windows cannot
build iOS.** The Expo app therefore **cannot be run on a device or simulator here.** Nothing in this
report claims the mobile UI was launched, rendered, or exercised on a device — because it was not.

What that leaves genuinely verifiable, and what was verified:

- The **offline-sync logic** (idempotent replay, conflict detection, convergence) — pure, in
  `packages/domain`, **19 unit tests**.
- The **mobile offline queue** the app runs on — pure core in `apps/mobile/src/lib`, **11 unit
  tests** with an in-memory store.
- The **mobile-sync backend** (device registration, scan replay, delta pull) — **10 integration
  tests** against a live database, plus a live-API script.
- The **Expo app source** — **typechecks against the real Expo SDK 52 / React Native 0.76 types and
  lints clean**, but is not compiled to a bundle or run.

## 2. Exit criteria

| Criterion                                                 | Result      | Evidence                                                                                                                                                     |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Offline scans queue and reconcile idempotently            | **Pass**    | Domain + queue unit tests; 10 integration tests; live script: APPLIED then DUPLICATE, one row                                                                |
| QR opens the authorised record; 403s for the unauthorised | **Partial** | The API path (`/assets/by-qr/:token`) is scope-enforced and tested since Phase 1; the scanner screen calls it correctly but **could not be run on a camera** |

## 3. Verification checklist

| #   | Check                    | Result                          | Detail                                                                             |
| --- | ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Formatting               | **Pass**                        | Prettier clean (lockfile excluded — its RN keys exceed the YAML parser)            |
| 2   | Linting                  | **Pass**                        | Mobile app included, 0 errors                                                      |
| 3   | Type checking            | **Pass**                        | Mobile app typechecks against real Expo/RN types                                   |
| 4   | Unit tests               | **Pass**                        | 224 passed (131 domain, 32 tokens, 14 contracts, 31 api, 5 web, **11 mobile**)     |
| 5   | Integration tests        | **Pass**                        | 119 passed incl. 10 new mobile-sync                                                |
| 6   | End-to-end tests         | **Not run**                     | Playwright is Phase 6; mobile e2e needs a device                                   |
| 7   | **Mobile tests**         | **Partial**                     | The mobile _logic_ is unit-tested; the _app on a device_ could not be run (see §1) |
| 8   | Accessibility            | **Not assessed**                | Requires the app running on a device/screen reader                                 |
| 9   | Dependency security scan | **Not run**                     | Phase 6                                                                            |
| 10  | Database migrations      | **Pass**                        | 7 applied (`device_tokens` added); status clean                                    |
| 11  | Seed                     | **Pass**                        | Unchanged; idempotent                                                              |
| 12  | Responsive layout        | **N/A here**                    | Native layout; not renderable in this environment                                  |
| 13  | Light and dark mode      | **Coded, not rendered**         | Screens read `useColorScheme` and the shared tone palette; not visually verified   |
| 14  | Role permissions         | **Pass**                        | Mobile tabs gate by permission; API enforces `inventory:adjust` etc. (tested)      |
| 15  | Audit logs               | **Pass**                        | Mobile writes flow through the same audited paths                                  |
| 16  | File access security     | **Pass**                        | Unchanged from Phase 3                                                             |
| 17  | AI enable/disable        | **Pass**                        | Unchanged; mobile does not touch AI (offline rule forbids it)                      |
| 20  | QR workflows             | **Backend pass, UI unverified** | Token resolution scoped and tested; scanner not run                                |

## 4. Test results

```
Unit         224 passed   domain 131 (+19 offline-sync) · mobile 11 · api 31 · tokens 32 · contracts 14 · web 5
Integration  119 passed   permissions 62 · workflow 11 · offboarding 9 · invoices 14 · mobile-sync 10 · canDecide 6 · health 5 · rate-limit 2
──────────────────────────────────────
Total        343 passed, 0 failed, 0 skipped
```

The offline-sync tests are the ones that matter most, because a bug there silently loses a warehouse
worker's afternoon of scans. They prove: replay is deterministic; an already-applied operation is a
DUPLICATE not a re-apply; a stale edit is a CONFLICT the user must resolve (but a scan, being an
observation, never conflicts); a vanished target is REJECTED; auth/AI/financial operations may never
be queued offline; and — the key property — **a partial sync retried converges to the same state as
a clean one** (`end-to-end replay is convergent`).

## 5. What was verified against the live API

A script driving the running API confirmed:

1. Device registration returns 200, and **re-registering the same token is idempotent** — no
   duplicate row.
2. An offline scan syncs as **APPLIED**; the identical batch replayed comes back **DUPLICATE**.
3. The session holds **exactly one scan**, classified **NOT_IN_REGISTER** for an unknown code.
4. Delta pull is **scoped**: the Super Admin sees 65 changed assets, the employee 16.

## 6. What was built but not run

The complete Expo app under `apps/mobile`:

- **Auth** — email/password, TOTP MFA challenge, and **biometric re-entry**: after first login the
  refresh token is kept in the platform keystore via expo-secure-store (not AsyncStorage), and Face
  ID / fingerprint unlocks the app. The access token lives only in memory.
- **Employee screens** — My assets, submit request, and the asset detail a scan opens, with confirm
  receipt and report damage.
- **Admin screens** — QR/barcode scanner (expo-camera) resolving to the authorised record, and
  offline physical inventory that captures scans into the SQLite-backed queue and shows a live
  pending/synced/conflict status line.
- **Push** — expo-notifications registration posting the Expo token to the device endpoint; the
  server fans out through the `PushProvider` (mock records, Expo implementation ready).

Every camera, biometric, notification and SQLite call targets the correct Expo API and the whole app
typechecks against those APIs' real type definitions — but **none of it was executed**, because there
is no device or emulator here.

## 7. Providers added

- **PushProvider** — mock (records instead of sending, flags simulated) and an Expo implementation
  written to the real push-API contract but throwing rather than faking if selected without
  credentials. Wired into the Phase 2 notification dispatch: APPROVAL_REQUIRED, ASSET_ASSIGNED,
  RECEIPT_CONFIRMATION, RETURN_REQUIRED and others now fan out to push alongside email, respecting
  the same mandatory/preference rules.

## 8. Known limitations

- **The mobile app has never run.** No device, no emulator, no iOS toolchain on Windows. This is the
  dominant limitation and everything visual/interactive in the app is unverified. A developer with an
  Android device and Expo Go, or an emulator, can `pnpm --filter @techpioasset/mobile start` — the
  code is written to run, but that path is untested here.
- **Push is simulated.** The mock records messages; real Expo delivery needs `PUSH_PROVIDER=expo`, an
  EAS project, and device tokens, none present.
- **Offline photo capture records intent only.** The `ASSET_PHOTO` operation queues the fact of a
  photo; the bytes upload through the existing storage route when online. Binary offline queueing is
  not implemented.
- **No conflict-resolution UI.** Conflicts and rejections are retained in the queue and surfaced in
  the status line and an alert, but the screen to review and re-apply them individually is not built.
- **Accessibility and theming are coded but unrendered.** Screens use `useColorScheme` and the shared
  palette and set touch targets generously, but none of this was verified on a screen.
- **The Expo config is unvalidated by a build.** `app.json`, plugins and permissions are written to
  spec but `expo prebuild` / a dev build was never run.

## 9. Recommendation

Phase 4's _verifiable_ half — the offline-sync engine and the mobile-sync backend — is complete and
tested to the same standard as every other phase. Its _unverifiable_ half — the app on a device — is
built and typechecked but honestly unproven, and cannot be proven in this environment.

Before relying on the mobile app, it must be run on a real device or an Android emulator: install the
Android SDK (or use a physical device with Expo Go), `pnpm --filter @techpioasset/mobile start`, and
walk the login → scan → offline-inventory → sync flow by hand. That is the one piece of Phase 4 this
machine could not do.

Phase 5 (maintenance, warranty, depreciation, advanced reports, scheduled exports) is entirely
server-and-web and fully verifiable here; it does not depend on the mobile app.
