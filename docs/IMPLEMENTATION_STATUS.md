# Documentation review and implementation status

## Phase 2 agency portal, 4 November 2026

Backend only; the Flutter app is not updated yet. Migration `20261104_phase2_agency` adds an `owner` or `agency` role on users, with each agency login tied to one packager by a composite foreign key, and a `journey_requests` table. The shared `authenticate` check is now owner-only, so all existing business routes refuse agency logins, and `/portal` uses its own check that takes the packager from the login. The owner creates logins and passes on a one-time setup code; there is still no public signup. See `API_IMPLEMENTED.md`.

Verified on a disposable local PostgreSQL 17: all twelve migrations apply from scratch and all 24 backend tests and `db:reconcile` pass. The Phase 1 and Phase 2 integration tests also pass connected as the restricted `app_runtime` role with `runtime_grants.sql` applied. The hosted database has not been migrated.

Found while verifying, not changed here: with the database session in a non-UTC time zone (Asia/Calcutta was tried), `password-recovery.test.ts` fails because an expired recovery code is accepted, and it passes once the session is UTC. Expiry checks read in application code, including agency setup codes, depend on this. Keep the hosted database session in UTC, which is the Supabase default, and check this before relying on another setting.

## Phase 1 admin API, 2 November 2026

Backend only; the Flutter app is not updated yet. Migration `20261102_phase1_admin` adds booking accounts (personal IRCTC IDs and agent portals, login name only), per-leg fares with PNR and ticket status for direct and connected tickets, service charge rules by packager and ticket type, packager credit limits and optional payment due dates. Existing bookings are backfilled with one leg each. New routes cover booking accounts and their usage, charge rules and quotes, leg tracking, the ticket tracker, a journey calendar, today/tomorrow agenda with payments due and overdue, and packagers with pending payments. Booking creation applies the charge rule when no fee is sent and blocks bookings past a credit limit unless overridden. Existing Flutter requests keep working because single-leg bookings still use the old top-level fields. See [`API_IMPLEMENTED.md`](API_IMPLEMENTED.md).

Verified on a disposable local PostgreSQL 17: all eleven migrations apply from scratch; `prisma migrate diff` shows no drift from this change except the intentional `NULLS NOT DISTINCT` unique index on charge rules; the runtime role check passes for 13 tables after `runtime_grants.sql`; all 21 backend tests (including the new `phase1-admin` integration test) pass with the API connected as `app_runtime`; `db:reconcile` reports zero mismatches. The migration has **not** been applied to the Supabase development database. Run `npm run db:migrate:deploy` from `backend/` and then reapply `prisma/runtime_grants.sql` as the admin role.

Found while verifying, not changed here: a fresh database needs an `app_runtime` role before migration `20261011_zzzzz_booking_deduction_entries` runs, and the CI workflow does not create one, so CI's migrate step will fail on a clean Postgres. The password-recovery integration test fails when the database session time zone is not UTC.

## Packager PDF reports, 12 October 2026

Flutter Analytics report generation now has only a packager filter and Search action. It loads all matching bookings regardless of date, groups results by packager, displays each booking's journey and financial details separately, and generates one all-time PDF per packager. Android 10+ saves the PDF directly to Downloads/TrainFundManager; earlier Android versions offer sharing. CSV/XLSX and date controls were removed. The API booking report now accepts omitted dates for all-time results and includes packager name, notes, collections, wallet deductions, customer due, advance credit and fund balance; integration and PDF generation tests pass.

## Analytics overview, 12 October 2026

The Flutter Analytics tab now starts with an all-time funds card showing net customer collections, service charges billed on bookings, and the ticket-minus-wallet fund balance. Its ring shows the balance share of ticket price against wallet deductions. Report filters and exports remain below the overview. The local Express dashboard response now includes `service_charge_paise`; it is derived from booking charges, because customer payments do not identify which portion paid the fee. The revised screen was installed and visually checked on the Android emulator.

## Booking edit, 12 October 2026

Flutter Booking Details now has an Edit action that opens the booking form with saved fields prefilled. `PATCH /bookings/:id` updates packager, journey, ticket price, fee and notes and adjusts current collection/deduction totals by appending immutable correction rows. A reason is required for money changes. The backend rejects stale edits, stores an audit snapshot, and includes corrections in dashboard, statement, report and timeline balances. The Prisma migration `20261012_booking_edit_adjustments` was applied to the development Supabase database; runtime access and reconciliation checks passed.

## Fund balance correction, 12 October 2026

Fund balance now derives from ticket booking price minus wallet deductions across the Flutter preview, booking API, dashboard, and web preview. Collections and service charge remain separate; Customer Due still derives from total payable minus net collections. The calculation is read from existing booking and ledger data, so no database migration or historical entry rewrite is needed.

## Frontend decision, 11 October 2026

The user clarified that Flutter is the primary application. `mobile/` now includes login, packagers, bookings, collections, transaction history, packager statements, correction dialogs, an API-backed dashboard and packager filtered all-time PDF booking reports. Wallet spending is entered as a Wallet Deduction on each booking using the operator's own external wallet; there is no separate Wallets navigation, directory or Wallet Cashflow report in the current app. The API retains historical wallet tables and endpoints without deleting records. Flutter calls only the authenticated Express API; the API alone connects to the private Supabase PostgreSQL schema. `web/` remains an additional Next.js client using shadcn/ui preset `b1e5uMopLE`, but its feature set is behind Flutter. The user chose to keep the API local for now. A development owner was created and the local API login/refresh/logout flow passed. Authenticated device workflows and hosted release gates remain open.

Reviewed 11 October 2026. The original repository contained the 15 Markdown plans below and no application code, Git history, database connection or deployment configuration. Work starts with M00 per the mandated module order in `07`.

| Document | Assessment and implementation implication |
|---|---|
| `00_README_START_HERE.md` | Clear architecture and money definitions. Its statement that code is not built was accurate before M00; README now tracks code status. |
| `01_PRODUCT_REQUIREMENTS_AND_PROJECT_PLAN.md` | Exact booking fields and acceptance criteria are usable. Real booking and authentication are outside M00. |
| `02_COMPLETE_SYSTEM_ARCHITECTURE.md` | Trust boundaries are coherent: Flutter → authenticated API → private DB. Hosting and credential choices remain to be configured. |
| `03_DATABASE_SCHEMA_AND_SECURITY.md` | Tables, owner scope and distinct ledgers are specified. M01 translated them into Prisma migrations and tested private role grants. |
| `04_FINANCIAL_RULES_AND_DATA_FLOW.md` | Customer due correctly excludes wallet spending. Implement paise and date-only parsing with invariant tests before financial writes. |
| `05_ORCHESTRATION_AND_API_CONTRACTS.md` | Endpoint and error shapes are clear. `/health` plus standard error envelope are implemented; other routes require M01–M09. |
| `06_FLUTTER_SCAFFOLD_AND_UI_SPEC.md` | Flutter dependencies, routes and form rules are specified. M00 provides a preview shell; exact booking form belongs to M06. |
| `07_MODULE_BY_MODULE_DEVELOPMENT.md` | Binding M00–M11 dependency order and gates. M01 requires an isolated PostgreSQL database and real connection testing. |
| `08_TESTING_SECURITY_AND_RELEASE.md` | Good acceptance matrix. M00–M02 checks run locally and against development PostgreSQL; finance and release gates are not passed. |
| `09_AI_AGENT_IMPLEMENTATION_RULES.md` | Restates locked stack and exclusions. It correctly prevents a demo client from being mistaken for secure authentication. |
| `10_LOCKED_TECH_STACK_AND_AUTH_SETUP.md` | Backend environment/JWT design is clear. Version examples must be checked against installed package versions; no keys should be committed. |
| `11_BACKEND_NODEJS_EXPRESS_JWT_IMPLEMENTATION.md` | Module layout and auth approach are coherent. Express, Prisma and custom JWT routes now exist; the development owner and API login flow are verified, while device integration remains. |
| `12_DEPLOYMENT_OPERATIONS_AND_HANDOVER.md` | A deployment plan, not evidence of provisioned infrastructure. Supabase project, HTTPS host, backup policy and signing remain open. |
| `13_PRISMA_SCHEMA_AND_TRANSACTION_PATTERNS.md` | Prisma v7 adapter and transaction strategy are the M01/M06 basis. Generated schema, real constraints and refresh concurrency pass; financial concurrency is future work. |
| `Train_Fund_Manager_NodeJS_Project_Plan.md` | Useful short summary, but references `Train_Fund_Manager_NodeJS_Documentation/`; actual path is `docs/`. |

## Problems and decisions that matter now

1. **Development database connected:** A separate Supabase project (`Train Fund Manager Development`, project ref `ctxcsnszajwteieeojvu`, Mumbai region) has the `app` migrations. The IPv6 direct endpoint is unreachable here, so the backend uses the TLS verified Session pooler. The restricted `app_runtime` role is created and verified. Privileged credentials are in ignored `.env.migrate`, separate from the API `.env`. A development owner has been bootstrapped; its password is stored only as an Argon2id hash.
2. **Device authentication remains unverified:** Backend JWT and Flutter token handling are wired. Local API login, `/me`, refresh and logout passed with the owner account. Emulator login and session restore have not yet been exercised. The financial routes are implemented and exercised through authenticated integration tests against development PostgreSQL.
3. **Money consistency is the main risk:** Initial booking, collection and wallet debit must be atomic, owner scoped and idempotent. The app must never infer an authoritative balance from a local preview or subtract wallet spending from customer due.
4. **Dependency resolution issue found during M00:** `flutter pub add shadcn_ui` initially selected version `0.0.0` because `intl` 0.20.3 conflicted with Flutter's localization pin. The project pins `intl` 0.20.2 and `shadcn_ui` 0.57.1 in the lockfile.
5. **Scope of an app release:** Corrections and reports are implemented, with real database tests. Device smoke testing, the complete security matrix, backup restoration, signed release and hosted deployment remain. Do not treat the development build as a released financial system.

## Module status

| Module | Status |
|---|---|
| M00 | Foundation implemented. Backend typecheck/lint/tests and Flutter analyzer/widget test passed locally. |
| M01 | Ten Prisma migrations applied to the isolated development database, including one-time password recovery and booking person mobile fields. The ten-table runtime privilege/trigger check passes. An isolated fresh-database restore drill remains for M10/M11. |
| M02 | Backend login, RS256 JWT, revocable sessions, refresh rotation/reuse detection, logout, me, password change, interactive owner bootstrap and local one-time recovery codes implemented. Real DB tests pass for bad login, tampering, audience, expiry, replay, concurrency, password change, logout, expired/reused recovery codes and reset session revocation. Development owner bootstrap and live login/refresh/logout passed. Deployment key rotation remains. |
| M03 | Flutter sign-in, secure refresh-token storage, in-memory access token, single-flight refresh, bounded 401 replay, route guards, password change, local-code forgot-password screen and logout wired. Analyzer and Android debug build pass. Real device login/restore/revocation and recovery form smoke tests remain. |
| M04 | Owner-scoped packager create/list/search/pagination/detail/edit/archive API and Flutter list/detail/forms implemented. Real PostgreSQL test covers cross-owner reads/writes/cursors. Device UI smoke test remains. |
| M05 | Wallet create/opening balance, top-up ledger, owner-scoped reads and Flutter wallet screens implemented. Real PostgreSQL tests pass for opening ₹20,000 plus ₹500, exact replay, concurrent replay and cross-owner denial. Device UI smoke test remains. |
| M06 | Atomic booking API, current booking financials, Flutter list/form/detail and due preview implemented. Optional service charge, initial collection and wallet deduction fields start blank and save as zero; optional booking person mobile is stored per booking and appears in details and reports. Real PostgreSQL tests pass booking create/edit/report, concurrent idempotency, cross-owner rejection, overdraft rollback and zero-entry creation. Device UI smoke test remains. |
| M07 | Additional collections, derived due/credit, transaction timeline, packager statement and Flutter views implemented. Real PostgreSQL tests cover partial payment, overpayment, concurrency/idempotency, multi-booking totals and cross-owner denial. Device UI smoke test remains. |
| M08 | Additional wallet debit, actual wallet/customer refunds, receipt/debit reversal and manual adjustments implemented with mandatory reason, original-entry caps, parent locks and idempotency. Flutter booking/wallet dialogs added. Real PostgreSQL tests cover replay, concurrent over-refund rejection, owner isolation and wallet guards. Device UI check remains. |
| M09 | API dashboard, paginated packager statement, UTC date-window booking/collection/wallet reports and Flutter per-packager PDF booking export implemented. Development DB tests reconcile separate ledgers and date windows; current export tests cover exact paise and Unicode PDF generation. A development benchmark at 100 packagers/1000 bookings/1000 ledger entries measured p95 dashboard 248.4 ms, statement 288.4 ms and booking report 264.5 ms after SQL summary optimization. These figures include local network latency and are not production capacity claims. |
| M10 | Backend integration and Flutter tests expanded; CI configured with disposable PostgreSQL, migrations and Android debug build. Read-only ledger reconciliation returns zero mismatches in development. Android debug APK built, installed and sign-in screen inspected on an emulator. GitHub CI has not run because no remote/PR is configured. Authenticated device acceptance, broader security/load testing and isolated backup restore remain. |
| M11 | Backend container, release signing guard and HTTPS release API guard prepared. User chose local hosting for now. The compiled local API returned `/health=ok` and database-backed `/ready=ready` with the development certificate. Docker image has not been built locally because Docker is unavailable. Production database/secrets, signed build, physical device test and recovery rehearsal remain for a hosted release. |

## M01 inputs and gate

The initial migration was applied and exercised against the development project. `app_runtime` can select the ten private application tables and cannot create in `app`, read migration history, access `auth`/`storage`, or update/delete append-only ledgers. SQL confirms `anon` and `authenticated` cannot use `app` or read its user table. The generic Supabase table scan warns that RLS is disabled; the custom JWT architecture deliberately uses private schema grants and backend owner filters, so that scan's claim of direct `anon` access is contradicted by privilege checks. Public Data API project settings still need explicit verification. The original database password was disclosed in chat during setup, so rotate it in Supabase and update ignored `.env.migrate` before privileged commands. Never paste the replacement secret in chat.

## Live development database inventory, 11 October 2026

`npm run db:inventory` returned one operator, two auth sessions and three refresh token records. The `packagers`, `bookings`, `customer_fund_entries`, `wallets`, `wallet_entries`, `operation_requests` and `audit_events` tables each have zero rows. Business records have not yet been entered by the operator. The API writes these tables through Prisma using the restricted runtime role; database-backed tests create and read temporary records, then remove them. All seven backend test files and nine tests pass. `db:reconcile` returned zero wallet mismatches, over-corrections and incomplete operations.

The original trigger-hardening migration was renamed so it runs after the initial table/function migration on a fresh deployment. Its SQL checksum was preserved in the development migration history. A later idempotent hardening migration was also applied. All five recorded checksums match, and `prisma migrate status` reports the schema up to date. A completely fresh database migration run remains a CI/restore gate because no disposable PostgreSQL instance is available locally.
