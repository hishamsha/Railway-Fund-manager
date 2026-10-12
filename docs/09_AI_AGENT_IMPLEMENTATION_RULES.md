# Strict AI Coding Agent Instructions — Train Fund Manager v5.0

> **Read `00_README_START_HERE.md` and `10_LOCKED_TECH_STACK_AND_AUTH_SETUP.md` first.** These are specifications, not evidence of an already built app or database. Implement modules `M00` through `M11` in `07_MODULE_BY_MODULE_DEVELOPMENT.md` sequentially.

## 1. Locked stack — do not substitute
- Client **Flutter/Dart**, UI **Flutter-native `shadcn_ui`**, navigation **GoRouter**, state **Riverpod**, HTTP **Dio**, tokens **flutter_secure_storage**.
- Required backend **Node.js/Express TypeScript**, **custom backend-issued RS256 JWT** with Argon2id passwords, revocable backend session and rotating opaque refresh token.
- Database **Supabase PostgreSQL ONLY**, via server-side **Prisma ORM + @prisma/adapter-pg**; schema migrations **Prisma Migrate**.
- Never replace the specified Node.js/Express/TypeScript backend with FastAPI, Firebase Auth, Supabase Auth, React SPA, or serverless-only authentication without written approval.

## 2. Forbidden tech and patterns
- **Do not use Supabase Auth**, `supabase_flutter`, `supabase.auth`, `auth.users`, `auth.uid()` or Supabase JWT/RLS as the operator authentication system.
- No direct Flutter → Supabase Data API/PostgreSQL or any database credentials in the mobile bundle.
- No JWT signing private key in Flutter; no `alg=none` or accepting JWT algorithms from token header without allowlist.
- No storing passwords/refresh tokens in plaintext files, logs, SharedPreferences or source control.
- No public self-registration, unprotected owner-bootstrap HTTP endpoint or unsecured reset-password flow.
- No ticket PNR, booking reference numbers, ticket status, traveler/passenger rows, seats, coaches, train search or actual ticket purchase integration.
- Do **not** add separate train name and train number fields: `train_identifier` is **ONE field**.
- No unnecessary Kafka, Redis, Kubernetes or Nginx in the initial project.
- No floating-point money, mutable finance balances without ledger support, silent ledger overwrites, client-supplied owner scope, or wallet-as-payment math.

## 3. Exact booking payload/fields

```text
packager_id
boarding_station
destination_station
journey_date
train_identifier           # ONE text field: name OR number
ticket_price_paise
service_charge_paise
initial_collected_paise
wallet_deducted_paise
wallet_id                   # legacy client only; omitted for recorded external-wallet deductions
```

Derived read-only response/UI: `total_payable_paise`, `collected_paise`, `wallet_deducted_paise`, `fund_balance_paise`, `signed_balance_paise`, `balance_due_paise`, `advance_credit_paise`. No payment-status field is required: due and credit derive from money.

## 4. Money invariants

```text
total_payable = ticket_price + service_charge
net_collected = receipts - customer_refunds - receipt_reversals
fund_balance = ticket_price - wallet_deducted
signed_balance = total_payable - net_collected
balance_due = max(signed_balance, 0)
credit = max(-signed_balance, 0)
wallet_balance = opening + topups + refunds + reversals + adjustment_credits
                 - booking_debits - adjustment_debits
```

Wallet spending must **never** reduce customer due directly. If price=₹10,000, service=₹1,000, collected=₹8,500, wallet deducted=₹10,000, **customer due=₹2,500** and **fund balance=₹0**. Collections and service charge do not enter fund balance.

## 5. Transaction requirements
- Idempotency UUID generated **once** per action in Flutter and sent via header.
- Backend verifies owner/session, request body, idempotency and resource ownership; wallet row locking applies only to legacy requests with a wallet ID.
- Booking + recorded initial deduction + initial collection + audit/idempotency response **commit or rollback together**. Later deductions append immutable booking deduction entries in their own idempotent transactions.
- Append-only finance records; incorrect entries corrected via linked reversal with reason.
- Report values aggregate separately before joining ledger tables.
- No money write is considered complete until confirmed by backend.

## 6. Authentication requirements
- `app_users` exists in private Supabase Postgres schema, **not Supabase Auth**.
- Argon2id password hash; generic login error and rate limiting.
- RS256 JWT from server, short TTL, verify `iss/aud/alg/kid/sub/sid/exp/nbf/typ`.
- Opaque single-use rotating refresh token, hash stored DB; revoke on reuse and logout.
- Backend checks active user/session on protected routes.
- Flutter secure storage and single-flight 401 refresh; bounded one replay with **same idempotency key**.
- Admin-only CLI bootstraps initial owner account; no public signup.

## 7. Module-by-module agent protocol
For each module:
1. Read relevant documents and existing code; cite changed files in dev report.
2. Write implementation checklist, API/DB contract and failure cases.
3. Implement backend and mobile as required; do not skip server auth/ownership checks.
4. Write unit/integration/widget tests before declaring done.
5. Run linter/analyzer/tests and show concrete results, not unverified claims.
6. Update docs/OpenAPI when signatures change.
7. Stop at gate; report any blocked or deferred test honestly.

## 8. Deliverable requirements
- One working monorepo with `mobile/`, `backend/`, `docs/`.
- Prisma Migrate migrations, least-privileged DB role setup, `.env.example` with placeholders.
- Express OpenAPI spec, owner bootstrap command, login/refresh/logout endpoints.
- Flutter with shadcn-styled navigation, packager/booking/wallet management.
- CI running tests and security scans, README and deployment/restore runbooks.

**Change control:** If an external dependency requires changing auth/DB architecture, stop and request an explicit product decision; don't silently restore Supabase Auth for convenience.
