# Product Requirements and Complete Project Plan

**Version 5.0.** Stack and authorization: Flutter + Flutter-native `shadcn_ui` + **Node.js/Express custom JWT** + **Supabase PostgreSQL database only**. See `10_LOCKED_TECH_STACK_AND_AUTH_SETUP.md`.

## 1. Problem and goal
An operator manages bulk train ticket requests from multiple packagers. Booking details, amount to be collected, amount already received and booking-wallet deductions must be visible together without mixing wallet spending with packager receipts. The application is a private accounting/management tool, not a reservation service.

## 2. Actors
- **Owner/operator:** Only authenticated MVP actor; handles bookings, collections, wallets, reporting and corrections.
- **Packager:** External agent/customer recorded in a directory, with potentially many bookings. **No packager login**.
- **External booking wallet:** Source of ticket purchases recorded manually; no provider integration.

## 3. New-booking form

| UI order | Input/derived field | Required | Rule |
|---|---|---|---|
| 1 | Packager | Yes | Search/select or add packager |
| 2 | Boarding Station | Yes | Nonempty string; must differ from destination |
| 3 | Destination Station | Yes | Nonempty string |
| 4 | Journey Date | Yes | Local date picker; historical date allowed |
| 5 | Train Name **or** Number | Yes | **ONE** text input `train_identifier` |
| 6 | Booking Person Mobile Number | No | Single booking contact, 10–15 digits with optional leading `+` |
| 7 | Train Ticket Booking Price | Yes | Combined price, > ₹0 |
| 8 | Service Charge | No | Starts blank; empty saves as ₹0 |
| 9 | Initially Collected Ticket Amount | No | Starts blank; empty saves as ₹0 |
| 10 | Wallet Deduction | No | Starts blank; empty saves as ₹0 |
| 11 | Source Wallet | No | Deduction is recorded as an amount; no wallet selection required. Legacy wallet accounts remain for historical data. |
| 12 | Total Payable | Calculated | Price + service charge |
| 13 | Fund Balance | Calculated | Ticket booking price − wallet deduction; collections and service charge excluded. Customer due/credit remains a separate calculation. |

Initial collection and initial wallet deduction are written as transactions at booking creation, not as editable balances. More collections may be posted later. An optional note can be supported but is not essential. All amounts are input as rupees and converted to exact integer paise.

## 4. Form illustration

```text
Packager                 ABC Travels
Boarding Station         Kozhikode
Destination Station      Chennai
Journey Date             2026-10-25
Train Name or Number     12626
Ticket Booking Price     ₹10,000.00
Service Charge          ₹1,000.00
Total Collected Fund     ₹8,500.00
Wallet Deducted Fund     ₹10,000.00
Wallet                   Main Ticket Wallet
------------------------
Total Payable            ₹11,000.00
Balance Fund Due         ₹2,500.00
```

## 5. Feature inventory

| Priority | Feature | Description |
|---|---|---|
| P0 | Operator login | Password-based backend login returns JWT + rotated refresh credential |
| P0 | Persist signed-in session | Client refreshes tokens safely; logout revokes server session |
| P0 | Packager management | Create, edit, search, archive without deleting historical rows |
| P0 | Simplified booking CRUD | Multiple bulk bookings per packager, journey edits and financial preview |
| P0 | Atomic initial funding | Booking + optional customer receipt + optional wallet debit: all-or-nothing |
| P0 | Customer collection | Multiple partial receipts, payment history, current due |
| P0 | Wallet ledger | Opening amount, top-ups, booking deductions, refunds/reversals |
| P0 | Accurate dashboard | Payable, received, due, credits, wallet balance, fees billed |
| P0 | Security, audit, retry | Per-owner permissions, password hashing, JWT checks, idempotency |
| P1 | Statements/reports | By packager, booking, receipt date and wallet event date |
| P1 | Exports | PDF, CSV, XLSX to device via permitted Flutter packages |
| P1 | Corrections | Append reversal/correction event; never delete posted money history |
| P2 | Multi-staff access | Later phase only; requires approved roles/tenant redesign |

## 6. Screens and navigation
1. **Splash/auth gate**: restores secure session or sends to Login.
2. **Login**: email and password; invalid credentials never identify which field failed.
3. **Dashboard**: total active packagers, bookings, billed fees, receipts, outstanding, wallet summary. Clearly label snapshot totals vs date-window cashflow.
4. **Packagers**: list/search/archive/create; select to view booking history and net due/credit.
5. **Create Booking**: exact fields from Section 3, live preview, once-only Save and retry.
6. **Bookings**: list and filters (packager, journey date, origin/destination), opening detail.
7. **Booking Details**: journey info, billed amount, collected fund, separate wallet spend, due/credit, payment history, actions to add receipt.
8. **Wallets**: wallet balance, entries, top-up and booking deductions.
9. **Reports**: booking, collections, service-fee and wallet summaries, export.
10. **Settings**: change password, logout, selected display preferences, account profile.

## 7. Business workflows
- Create owner via secure bootstrap → login via Node.js/Express → receive JWT → access app routes.
- Create/select packager → fill journey + financial fields → preview → POST booking with idempotency key → backend transaction → refresh booking detail.
- Receive later payment → POST customer collection → backend appends ledger entry → recompute due.
- Wallet spending → POST booking-linked debit → backend locks wallet/validates funds → appends debit → recompute wallet balance (does not affect customer balance).
- Generate report → GET filtered summary and transaction detail via authenticated API → create CSV/PDF/XLSX locally.

## 8. Acceptance criteria
- Every packager can own more than one bulk booking.
- Exactly one train name/number textbox appears; one booking person mobile contact may be stored, without passenger records, PNR, status or booking references.
- A customer who paid ₹8,500 against ₹11,000 payable shows ₹2,500 due regardless of any wallet debit.
- Two requests with the same idempotency key cannot duplicate money entries.
- Failed wallet validation rolls back the whole initial booking transaction.
- An unauthenticated client cannot retrieve bookings, and an authenticated operator cannot access another user's records.
- Sign out or session revocation denies subsequent API access, including unexpired JWTs when strict session checking is enabled.
- Tokens and Postgres credentials are never logged or embedded in the Flutter bundle.
- Financial UI after Save renders **server-confirmed totals**, not guessed optimistic success.

## 9. Explicit exclusions
No ticket buying, third-party railway integration, PNR or ticket confirmation tracking, booking reference numbers, individual passenger records, train search/status, wallet-provider API integration, Supabase Auth, direct Supabase Data API use from Flutter, social sign-on or public self-registration in MVP.

## 10. Delivery milestones
1. Functional Flutter/shadcn shell and Express health endpoint.
2. Supabase PostgreSQL connected from Node.js/Express; migrations applied.
3. Custom JWT login/refresh/logout + route guard.
4. Packager, wallets, simplified booking, and atomic ledger flows.
5. Dashboard/reporting and audit/corrections.
6. Auth/finance/security tests and signed Android build.
