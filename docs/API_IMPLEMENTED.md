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
| POST | `/packagers` | `name`, optional `phone`, `notes` | 201 `{ "packager": ... }` |
| GET | `/packagers/:id` | — | `{ "packager": ... }` or 404 |
| PATCH | `/packagers/:id` | Any of `name`, `phone`, `notes`, `is_archived` | `{ "packager": ... }` or 404 |

Packager fields: `id`, `name`, `phone`, `notes`, `is_archived`, `created_at`, `updated_at`. Archiving preserves bookings and history. All list/detail/update queries are owner scoped. No hard-delete endpoint exists.

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

Create body: `packager_id`, `boarding_station`, `destination_station`, date-only `journey_date`, one `train_identifier`, optional `booking_person_mobile` (10–15 digits, optional leading `+`), `ticket_price_paise` (>0), `service_charge_paise` (>=0), `initial_collected_paise` (>=0), `wallet_deducted_paise` (>=0), optional `notes`. Blank optional money inputs in Flutter are sent as zero. No source wallet is needed. For compatibility, the API still accepts `wallet_id` for older clients and posts those deductions to the existing wallet ledger. The mobile number is a single booking contact field; no passenger records, PNR, reservation reference or booking status fields are accepted.

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
