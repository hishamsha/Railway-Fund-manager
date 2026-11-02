# Implemented API contracts

Base path: `/api/v1`. Protected routes require `Authorization: Bearer <access_token>`. All owner IDs are taken from a verified JWT and live database session. JSON errors use `{ "error": { "code", "message", "request_id" } }` (validation errors also include `fields`).

## Authentication (M02)

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/auth/login` | `{ "email", "password" }` | `access_token`, `token_type`, `expires_in`, `refresh_token`, `user` |
| POST | `/auth/refresh` | `{ "refresh_token" }` | Rotated token pair and user |
| GET | `/auth/me` | Bearer access token | `user` |
| POST | `/auth/logout` | Bearer access token | 204; server session revoked |
| POST | `/auth/change-password` | `{ "current_password", "new_password" }` plus Bearer | 204; other sessions revoked |
| POST | `/auth/reset-password` | `{ "email", "recovery_code", "new_password" }` | 204; one-time code consumed and all sessions revoked |

Refresh tokens are single use. Reuse revokes the session family. Access JWTs expire after ten minutes; refresh tokens after fourteen days or the earlier absolute session expiry.

## Packagers (M04)

| Method | Path | Body/query | Result |
|---|---|---|---|
| GET | `/packagers` | `limit=1..100`, optional `cursor`, `search`, `include_archived=true` | `{ "items": [...], "next_cursor": "uuid-or-null" }` |
| POST | `/packagers` | `name`, optional `phone`, `notes`, `credit_limit_paise` | 201 `{ "packager": ... }` |
| GET | `/packagers/:id` | — | `{ "packager": ... }` or 404 |
| PATCH | `/packagers/:id` | Any of `name`, `phone`, `notes`, `credit_limit_paise`, `is_archived` | `{ "packager": ... }` or 404 |

Packager fields: `id`, `name`, `phone`, `notes`, `credit_limit_paise` (`null` = no limit), `is_archived`, `created_at`, `updated_at`. Archiving preserves bookings and history. All list/detail/update queries are owner scoped. No hard-delete endpoint exists.

## Wallet baseline (M05)

| Method | Path | Body/query | Result |
|---|---|---|---|
| GET | `/wallets` | `limit=1..100`, optional `cursor`, `include_inactive=true` | `{ "items": [...], "next_cursor": "uuid-or-null" }` |
| POST | `/wallets` | `name`, `opening_balance_paise`; UUID `Idempotency-Key` header | 201 `{ "wallet": ... }`; replay 200 |
| GET | `/wallets/:id` | — | `{ "wallet": ... }` or 404 |
| GET | `/wallets/:id/entries` | Optional `limit`, `cursor` | Ledger page or 404 |
| POST | `/wallets/:id/top-ups` | `amount_paise` > 0, ISO `occurred_at`, optional `note`; UUID `Idempotency-Key` header | 201 `{ "wallet", "entry" }`; replay 200 |

Money is JSON integer paise and stored as PostgreSQL bigint. Opening balance lives only on the wallet row. Top-ups append `top_up` entries and update the guarded cached balance in one transaction. A key reused with different content yields 409. Wallets and entries are owner scoped.

## Atomic booking creation (M06)

| Method | Path | Body/query | Result |
|---|---|---|---|
| GET | `/bookings` | `limit=1..100`, optional `cursor`, `packager_id` | `{ "items": [...], "next_cursor": "uuid-or-null" }` |
| POST | `/bookings` | Exact simplified form below; UUID `Idempotency-Key` | 201 `{ "booking", "financials" }`; replay 200 |
| GET | `/bookings/:id` | — | Current `{ "booking", "financials" }` or 404 |
| POST | `/bookings/:id/deductions` | `amount_paise` > 0, ISO `occurred_at`, optional `note`; UUID `Idempotency-Key` | 201 `{ "entry", "financials" }`; identical replay 200 |
| PATCH | `/bookings/:id` | All editable booking fields and current collection/deduction totals; UUID `Idempotency-Key` | 200 `{ "booking", "financials" }`; stale edit 409 |

Create body: `packager_id`, `boarding_station`, `destination_station`, date-only `journey_date`, one `train_identifier`, optional `booking_person_mobile` (10–15 digits, optional leading `+`), `ticket_price_paise` (>0), `service_charge_paise` (>=0), `initial_collected_paise` (>=0), `wallet_deducted_paise` (>=0), optional `notes`. Blank optional money inputs in Flutter are sent as zero. No source wallet is needed. For compatibility, the API still accepts `wallet_id` for older clients and posts those deductions to the existing wallet ledger. The mobile number is a single booking contact field; no passenger records are kept. Legs, PNR, ticket status, service charge rules, credit limits and payment due dates are described under Phase 1 admin below.

The server checks owner alignment and claims the idempotency key, then inserts the booking, recorded deduction amount, and optional receipt in one transaction. It locks and debits an app wallet only for legacy requests that supply `wallet_id`. `financials.fund_balance_paise = ticket_price_paise - wallet_deducted_paise`; collections and service charge are excluded. `financials.balance_due_paise = max(ticket + fee - collected, 0)` remains a separate customer due figure. Identical retries return the committed result; different content with the same key returns 409.

Later deductions append immutable `booking_deduction_entries` without requiring a source wallet. They update the derived fund balance but do not change customer due or an app-wallet account.

Booking edits send packager, stations, journey date, train, optional booking person mobile, ticket price, service charge, notes, `collected_paise`, `wallet_deducted_paise`, `expected_updated_at`, `expected_collected_paise`, `expected_wallet_deducted_paise`, and `correction_reason`. A reason is required when money totals change. The API locks the booking, rejects stale values, updates descriptive fields and prices, appends signed correction entries for money changes, and audits before/after values in one transaction. Earlier receipts and deductions remain unchanged. Dashboard, statements, reports and the timeline include the corrections.

## Collections and statements (M07)

| Method | Path | Body/query | Result |
|---|---|---|---|
| POST | `/bookings/:id/collections` | `amount_paise` > 0, `method` in `cash`/`upi`/`bank`/`other`, ISO `occurred_at`, optional `note`; UUID `Idempotency-Key` | 201 `{ "entry", "financials" }`; identical replay 200 |
| GET | `/bookings/:id/entries` | Optional `limit=1..100`, `offset=0..10000` | Merged customer/wallet transaction timeline `{ "items", "next_offset" }` |
| GET | `/packagers/:id/statement` | Optional `limit=1..100`, `offset=0..10000` | `{ "packager", "summary", "items", "next_offset" }` with per-booking due/credit |

Collections are append-only customer receipts. An overpayment appears as `advance_credit_paise`; it does not change wallet balance. The statement includes total payable, net collected, per-booking dues and credits, and the packager net position. All routes are owner scoped.

## Dashboard summary (M09 partial)

| Method | Path | Result |
|---|---|---|
| GET | `/dashboard` | Owner-scoped counts, total payable, collected, customer due/credit, active wallet balance and five recent bookings |

The Flutter dashboard and report screens display server totals; exports are created locally from authenticated, paginated responses. `/dashboard` also includes all-time `service_charge_paise`, the sum of service charges billed on bookings. These charges are not separately tracked as paid in the current ledger.

`GET /reports/bookings` also returns each booking's packager name, notes, net collected amount, wallet deduction, fund balance, customer due and advance credit. The Flutter report search uses only an optional packager ID and includes all booking dates, then groups all matching bookings by packager. Each group exports to its own PDF. CSV, XLSX, report-type, date-clock and date-range choices have been removed from the Flutter report screen.

## Corrections and advanced wallet operations (M08)

All write paths below require a UUID `Idempotency-Key`, use locked parent rows, append ledger and audit entries, and return 201 (`200` for an identical replay). A key reused with a changed payload returns 409.

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/wallets/:id/booking-debits` | `booking_id`, `amount_paise`, ISO `occurred_at`, optional `note` | `{ "wallet", "entry" }` |
| POST | `/wallets/:id/refunds` | `original_debit_id`, `amount_paise`, ISO `occurred_at`, mandatory `reason` | `{ "wallet", "entry" }` |
| POST | `/wallets/:id/adjustments` | `direction=credit|debit`, `amount_paise`, ISO `occurred_at`, mandatory `reason` | `{ "wallet", "entry" }` |
| POST | `/bookings/:id/customer-refunds` | `original_receipt_id`, `amount_paise`, `method=cash|upi|bank|other`, ISO `occurred_at`, mandatory `reason` | `{ "entry" }` |
| POST | `/finance/:entryId/reverse` | ISO `occurred_at`, mandatory `reason` | `{ "entry" }`, plus `wallet` for debit reversal |

Refunds must reference an original receipt or booking debit and cannot exceed its amount after prior refunds/reversals. A reversal consumes the remainder once. Wallet changes are locked and cannot make the balance negative or exceed its supported maximum. Customer refunds and receipt reversals never change wallet balance.

## Date-window reports (M09)

| Method | Path | Query and result |
|---|---|---|
| GET | `/reports/bookings` | Optional paired `from_date`, `to_date` (omit both for all-time); optional `clock=created_at|journey_date`, `packager_id`, `limit`, `offset`. Returns ticket, fee and payable totals plus paginated bookings. |
| GET | `/reports/collections` | Required dates; optional `packager_id`, `limit`, `offset`. Uses `occurred_at`; returns receipts, refunds, reversals and net collected. |
| GET | `/reports/wallets` | Required dates; optional `packager_id`, `limit`, `offset`. Uses `occurred_at`; returns wallet credits, debits, net movement and net booking spend. |

When supplied, date ranges are inclusive UTC dates and are limited to 366 days. Collections and wallet reports still require dates. A packager filter on wallet cashflow includes booking-linked movements only. All responses are owner scoped and contain `summary`, `items`, and `next_offset`. The Flutter booking report loads paginated results and saves one all-time PDF per packager to Android Downloads/TrainFundManager (or offers sharing on Android versions before 10). Other API reports remain available to API clients.

## Phase 1 admin: ticket sources, legs, charges, credit and dues

### Booking accounts

Personal IRCTC IDs and agent portals that tickets are bought from. Only a login name is stored; there is no password field.

| Method | Path | Body/query | Result |
|---|---|---|---|
| GET | `/booking-accounts` | Optional `include_inactive=true` | `{ "items": [...] }` |
| POST | `/booking-accounts` | `name`, `kind` (`personal_id` or `agent_portal`), optional `login_id`, `notes` | 201 `{ "booking_account": ... }` |
| GET | `/booking-accounts/:id` | — | `{ "booking_account": ... }` or 404 |
| PATCH | `/booking-accounts/:id` | Any of the create fields or `is_active` | `{ "booking_account": ... }` or 404 |
| GET | `/booking-accounts/:id/usage` | Optional `from_date`, `to_date` (journey dates) | Ticket count, cancelled count, fare total excluding cancelled legs, counts by status |

### Service charge rules

A rule with `packager_id: null` is the default for a ticket type (`direct` or `connected`); a packager rule overrides it.

| Method | Path | Body/query | Result |
|---|---|---|---|
| GET | `/service-charge-rules` | Optional `packager_id` (its rules plus defaults) | `{ "items": [...] }` |
| PUT | `/service-charge-rules` | `packager_id` (uuid or null), `ticket_type`, `charge_paise` | 201 created or 200 updated `{ "rule": ... }`; audited |
| DELETE | `/service-charge-rules/:id` | — | 204; audited |
| GET | `/service-charge-rules/quote` | `packager_id`, `ticket_type` | `{ "charge_paise", "source": "packager"|"default"|"none" }` |

### Booking legs

Every booking has one or more legs (`booking.legs`, ordered by `sequence`). Each leg has `boarding_station`, `destination_station`, `journey_date`, `train_identifier`, `fare_paise`, optional `booking_account_id`, optional `pnr` (6–20 letters/digits) and `ticket_status`: `requested`, `booked` (default), `confirmed`, `waitlisted`, `rac`, `cancelled` or `travelled`. Bookings created before Phase 1 were given one leg from their own fields.

- **Create** accepts either the existing top-level route fields (one direct leg, optionally with `booking_account_id`, `pnr`, `ticket_status`) or `legs` (1–20) with the top-level `boarding_station`, `destination_station`, `journey_date`, `train_identifier` and `ticket_price_paise` omitted. With legs, the booking takes the first leg's boarding station, date and train list, the last leg's destination, the sum of fares as ticket price, and `ticket_type: "connected"` when there is more than one leg. Legs must not go back in date order, and a journey ending where it started must be two bookings.
- **Service charge**: when `service_charge_paise` is omitted, the quote rule above applies. Sending it, including 0, overrides the rule.
- **Credit limit**: when the packager has `credit_limit_paise`, a booking that would raise its net due (all payable minus net collections, plus this booking's payable minus `initial_collected_paise`) above the limit returns 409 `CREDIT_LIMIT_EXCEEDED`, unless the body has `allow_over_credit_limit: true`. Concurrent bookings for one packager are serialized by a row lock.
- **Payment due date**: optional `payment_due_date` on create and edit (`null` clears it). The effective due date is `payment_due_date`, else the journey date.
- **Edit** (`PATCH /bookings/:id`) may send `legs` instead of the top-level route fields to replace all legs. Without `legs`, a single-leg booking's leg follows the edited route and keeps its id, account, PNR and status. A connected booking edited without `legs` must keep its route and price, otherwise 409 `LEGS_REQUIRED`.
- `PATCH /bookings/:id/legs/:legId` sets any of `ticket_status`, `pnr`, `booking_account_id` (null clears). It does not change money and is audited as `booking_leg`/`track`.

### Tracker and dues

"Today" defaults to the current date in India (Asia/Kolkata); every view accepts an explicit date.

| Method | Path | Query | Result |
|---|---|---|---|
| GET | `/tickets` | Optional `status`, `booking_account_id`, `packager_id`, `from_date`, `to_date`, `limit=1..100` (50), `offset` | Legs by journey date with `booking_id`, `packager_name`, `ticket_type`, `booking_person_mobile`; `next_offset` |
| GET | `/calendar` | `from_date`, `to_date` (at most 63 days) | `{ "days": [{ "date", "total", "by_status" }] }` |
| GET | `/agenda` | Optional `date` | `today_journeys`, `tomorrow_journeys` (cancelled legs excluded), `payments_due_today` and `overdue_payments` (`total_due_paise`, items with `balance_due_paise` and `due_date`) |
| GET | `/finance/pending-agencies` | Optional `date`, `include_settled=true` | Per packager `net_due_paise`, `advance_credit_paise`, `overdue_paise`, `oldest_due_date`, `credit_limit_paise`, `available_credit_paise`, `over_limit`; sorted by net due; `totals` |

The runtime role can delete only `booking_legs` (replaced on edit) and `service_charge_rules`; reapply `prisma/runtime_grants.sql` after migrating.
