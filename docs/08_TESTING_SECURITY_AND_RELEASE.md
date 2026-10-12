# Testing, Security, Reliability, and Release Checklist

Stack under test: Flutter `shadcn_ui` → own **Node.js/Express custom JWT** (RS256) → **Supabase PostgreSQL database only**. There is no Supabase Auth/SDK integration to test.

## 1. Financial correctness matrix

| ID | Scenario | Expected |
|---|---|---|
| FIN-001 | Ticket ₹10,000, fee ₹1,000 | Payable ₹11,000 |
| FIN-002 | Above, collected ₹8,500 | Packager due ₹2,500 |
| FIN-003 | Above, wallet deducted ₹10,000 | Due **still ₹2,500** |
| FIN-004 | Receive later ₹2,500 | Due ₹0, wallet unchanged |
| FIN-005 | Payable ₹2,000; collected ₹2,300 | Due ₹0, credit ₹300 |
| FIN-006 | No initial collection | Due = total payable; no receipt row |
| FIN-007 | Wallet ₹20,000, debit ₹10,000 | Wallet ₹10,000 |
| FIN-008 | Wallet top-up ₹500 | Wallet increases ₹500 only |
| FIN-009 | Provider wallet refund ₹700 | Wallet increases; customer due unchanged |
| FIN-010 | Customer refund ₹500 | Net collected falls; due increases; wallet unchanged |
| FIN-011 | Reverse mistaken receipt | Corrective row appended; original remains |
| FIN-012 | Multiple bookings per packager | Per-booking and packager totals reconcile |
| FIN-013 | Wallet ₹1,000, attempted debit ₹1,500 | Reject **all** initial booking writes |
| FIN-014 | Two concurrent wallet debits | No overdrawn wallet |
| FIN-015 | Same key/body retried 10 times | Exactly one finance operation |
| FIN-016 | Same key, different payload | HTTP 409; no new money rows |
| FIN-017 | ₹12.345, NaN, invalid negatives | Validation rejected |
| FIN-018 | Single train value `12626` or `Kerala Express` | Either accepted in same input |
| FIN-019 | Same boarding/destination, empty train | Validation rejected |
| FIN-020 | Add collection to another owner's booking | Denied, no writes |
| FIN-021 | Customer + wallet ledger joined for report | Totals not multiplied |
| FIN-022 | Date-only journey at timezone boundary | Saved date remains unchanged |

## 2. Auth and session security matrix

| ID | Scenario | Expected |
|---|---|---|
| AUTH-001 | Correct login | Backend-issued signed access JWT + opaque refresh |
| AUTH-002 | Wrong password/unknown email | Same generic error; rate limit prevents brute force |
| AUTH-003 | Password in database | Only Argon2id hash exists |
| AUTH-004 | JWT with `alg=none`/wrong algorithm | Rejected |
| AUTH-005 | Invalid signature/issuer/audience/`kid` | Rejected |
| AUTH-006 | JWT missing `sub`, `sid`, `typ`, `exp` | Rejected |
| AUTH-007 | Expired or future-invalid JWT | Rejected; bounded refresh possible |
| AUTH-008 | Revoked session with still-valid JWT | Rejected |
| AUTH-009 | Refresh token used once | Rotates successfully |
| AUTH-010 | Previously rotated refresh token reused | Detect and revoke family/session |
| AUTH-011 | Two concurrent refresh calls | One authorized chain; no accidental duplicate sessions |
| AUTH-012 | Logout | Backend revokes session; Flutter clears device storage |
| AUTH-013 | Owner A attempts owner B packager/wallet/booking | No read or write access |
| AUTH-014 | Flutter app binary inspected | No JWT private key/DB connection secrets inside |
| AUTH-015 | Supabase Data API request for `app` schema | No public access |
| AUTH-016 | User's password changed | Other sessions revoked according to policy |
| AUTH-017 | Tampered Flutter due/owner fields | Backend recalculates/ignores owner |

## 3. API/backend integration
- Run Prisma ORM integration tests against dedicated **test PostgreSQL**; not mocked DB for transaction/concurrency gates.
- Auth middleware tests: invalid Bearer formats, clock skew, no signature algorithm downgrade, disabled user and stale session.
- End-to-end booking POST verifies initial booking + receipt + wallet debit + audit + operation record in same commit.
- Rollback tests deliberately provoke insufficient wallet, DB constraint failure, wrong packager, duplicated request and timeout.
- Refresh rotation test with two simultaneous requests and stale token reuse; ensure deterministic failure policy.
- Assert pagination caps and filtered owner queries for all endpoint families.
- Verify `500` responses contain no SQL errors, credentials or JWTs.
- Test one-row-per-booking aggregate with multiple wallet entries **and** multiple receipts.
- Test migration from empty DB and safe existing-data upgrade on staging copy.

## 4. Flutter widget and integration tests
- Login invalid state, form validation, session restore and logout state.
- One train name-or-number text field and date selection.
- Wallet deduction can be entered without a source-wallet picker; fund balance equals ticket booking price minus the deduction and excludes collections and service charge.
- Rupee parser and formatter to integer paise; no doubles.
- Save disabled while loading and stable idempotency key on retry.
- Due/credit cards label positive owed vs advance credit properly.
- Auth interceptor refreshes in single-flight, retries once, retains write idempotency key, routes to login on second 401.
- Dark/light theme (if implemented), accessible text semantics, errors and offline feedback.

## 5. Security deployment checklist
- [ ] HTTPS API with appropriate certificate; no non-TLS production endpoints.
- [ ] Supabase DB TLS encryption and hostname verification configured for hosting connectivity.
- [ ] Server-side JWT private signing key in secret manager, not repo/mobile/docs.
- [ ] JWT `iss/aud/alg/typ/sid` enforced and session revocation checked.
- [ ] Strong Argon2id parameters benchmarked and tested on host.
- [ ] Random refresh token hashes stored server-side and rotated/reuse-detected.
- [ ] Rate limiting by IP/account and login attempt monitoring.
- [ ] `app` schema hidden/unexposed via Supabase Data API; grants checked.
- [ ] DB runtime role least privileged; elevated migration role separate.
- [ ] Audit entries append-only, financial writes idempotent and WAL/backup policy understood.
- [ ] Sensitive payloads/headers redacted from logs and telemetry.
- [ ] Device refresh token kept only in secure storage.
- [ ] Dependency scans, Flutter signing, mobile permissions, API input size limits.
- [ ] Backup/restore rehearsal for DB; production rollback plan.

## 6. Performance and reliability
- Benchmark 100 packagers / 1,000 bookings / many receipts and wallet entries using realistic data; ensure filtered list, aggregates and statement queries are indexed.
- P95 API latency target can be established from actual hosting; do not claim measured figures without test.
- Managed network/API timeouts must preserve idempotency, especially while creating bookings.
- Keep DB connection pool appropriately small for starter Supabase project; monitor saturation.
- Read-only cache is optional; avoid offline financial edits.

## 7. Release gates
1. `flutter analyze` and unit/widget tests pass.
2. Backend lint/type checks, unit tests and OpenAPI contract tests pass.
3. Real-Postgres integration and concurrency tests pass.
4. Auth security matrix and owner isolation pass.
5. Production build does not contain secrets or test project URLs.
6. Live HTTPS smoke test and logout revocation pass.
7. Database backup and tested restore documented.
8. App signed and installed on a physical Android device; production checks repeated before real use.

No launch with unresolved double-debit, double-collection, cross-owner data leak or revoked-session acceptance.
