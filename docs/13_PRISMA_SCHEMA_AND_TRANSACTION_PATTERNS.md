# Prisma Models, Migrations, Transactions and Data Safety — Implementation Blueprint

**Version 5.0.** Companion to `03_DATABASE_SCHEMA_AND_SECURITY.md` and `11_BACKEND_NODEJS_EXPRESS_JWT_IMPLEMENTATION.md`. This is a **design blueprint**, not a claim that schema/migrations are already deployed.

## 1. Required PostgreSQL entities

| Table in `app` schema | Main responsibility | Relationships / critical constraints |
|---|---|---|
| `app_users` | Owner/operator custom login | Unique `email_normalized`, Argon2id `password_hash` |
| `auth_sessions` | Revocable JWT sessions | FK `user_id`, expires/revoked fields |
| `refresh_tokens` | Single-use opaque token rotation | FK session; unique `token_hash`; consumed/replaced markers |
| `packagers` | External customers/agents | `owner_id`, name, archive flag; no login |
| `bookings` | One packager train journey | owner + packager; exactly one `train_identifier`; price + fee + recorded initial wallet deduction |
| `customer_fund_entries` | Actual receipts and refunds | append-only; booking FK; idempotency FK |
| `booking_deduction_entries` | Later external-wallet spending amounts | append-only; booking FK; idempotency FK; no source-wallet FK |
| `wallets` | Booking wallet accounts | owner, opening balance/guarded current balance |
| `wallet_entries` | Top-ups, booking spending, refunds | append-only; wallet FK and optional booking FK |
| `operation_requests` | Safe write deduplication | unique `(owner_id, request_id)` + `payload_hash`, result |
| `audit_events` | Who changed what and why | actor, owner, entity, sanitized change details |

**Cross-owner protections:** validate every relation, including `(owner_id, packager_id)`, `(owner_id, wallet_id)` and `(owner_id, booking_id)` with owner-aligned database constraints where possible. Do not allow privileged migrations to silently create tables in the exposed `public` schema.

## 2. Prisma 7 model pattern

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
  schemas = ["app"]
}

model Packager {
  id         String   @id @default(uuid()) @db.Uuid
  ownerId    String   @map("owner_id") @db.Uuid
  name       String
  isArchived Boolean  @default(false) @map("is_archived")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  bookings   Booking[]

  @@unique([ownerId, id])
  @@index([ownerId, name])
  @@map("packagers")
  @@schema("app")
}

model Booking {
  id                  String   @id @default(uuid()) @db.Uuid
  ownerId             String   @map("owner_id") @db.Uuid
  packagerId          String   @map("packager_id") @db.Uuid
  boardingStation     String   @map("boarding_station")
  destinationStation  String   @map("destination_station")
  journeyDate         DateTime @map("journey_date") @db.Date
  trainIdentifier     String   @map("train_identifier")
  ticketPricePaise    BigInt   @map("ticket_price_paise")
  serviceChargePaise  BigInt   @default(0) @map("service_charge_paise")
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  packager            Packager @relation(fields: [ownerId, packagerId], references: [ownerId, id])

  @@unique([ownerId, id])
  @@index([ownerId, packagerId, journeyDate])
  @@map("bookings")
  @@schema("app")
}
```

**Partial schema only.** Complete all listed models and their inverse relations before running Prisma validation. Exact model/field naming may be adjusted consistently, but database columns and behavior are locked. Add `CHECK` constraints for money >0/nonnegative, different boarding/destination, token lifetime, meaningful text, and ledger immutability using **hand-reviewed SQL migrations** where Prisma Schema Language cannot represent a constraint. Use constraints AND Zod validation; never treat Prisma types as a replacement for validation.

## 3. Money and timestamps
- Flutter accepts rupee string input (`8500`, `8500.50`), performs exact decimal text-to-paise conversion and sends integer paise (not floats).
- Node verifies integer/positive bounds via Zod and uses JS `bigint` for money/math. Set a strict per-field maximum safely representable in JSON Number (for example, ≤ 1e12 paise); ensure sums also remain safe for JSON serialization or send decimal **strings** consistently.
- Prisma `BigInt` is JavaScript BigInt. Provide a single serializer converting it to validated safe integer JSON numbers (or contract-defined strings); never call naive `JSON.stringify` on Prisma BigInt objects.
- `journey_date` is a **date only**, never reinterpret it as a UTC local shift in the UI. `created_at` and ledger timestamps stored UTC; display in Asia/Kolkata.

## 4. Migration flow
1. Separate dev/staging/prod Supabase projects. Get DB URLs from dashboard, put secrets only in backend/CI.
2. Create restricted backend runtime role and separate migration role; have a privileged admin create/grant the private `app` schema initially.
3. Prisma 7 `schema.prisma`: `schemas = ["app"]` and every model has `@@schema("app")`.
4. `prisma.config.ts` uses `MIGRATION_DATABASE_URL`; runtime adapter uses `DATABASE_URL`.
5. Generate a migration in a development environment: `npx prisma migrate dev --name init_app_schema`; inspect generated SQL for proper schema, tables, indexes, FKs.
6. Add SQL checks, unique partial indexes where needed, immutable-ledger protections, grants. Review and commit both migration SQL and Prisma schema.
7. `npx prisma validate`, `npx prisma generate`, full tests. CI/staging `npx prisma migrate deploy`. Do not run schema pushes or new migration generation against production.
8. `prisma migrate deploy` with migration privileges is a controlled deployment step, not an automatic runtime server task.

## 5. Transaction locking and exactly-once intent
- Every booking creation combines booking, initial customer receipt, wallet debit, audit event, and operation request in ONE database transaction.
- For wallet debit, lock wallet row consistently before checking balance. Option A: recompute ledger sum while lock held and ensure all writers take that lock. Option B (recommended): maintain `wallets.current_balance_paise` (guarded cache), initialize it from `opening_balance_paise` exactly once and update it in the same transaction as each append-only entry; reconcile against `opening_balance_paise + signed wallet_entries` regularly. Do **not** add a second opening credit ledger entry if opening amount is already stored in the wallet row. Choose one and test it; never use a client-provided balance.
- Use owner-scoped lock SQL (`tx.$queryRaw`) with parameter interpolation supported by Prisma. Never build SQL identifiers/clauses from mobile strings.
- Claim unique operation key with payload hash inside same transaction; repeat same key+payload returns original committed response. If same key/different payload then 409. Use bounded retry for database serialization conflicts, but never duplicate ledger rows.
- Corrections/returns add **new** journal rows with `reversal_of_entry_id` and reason; refunds may not exceed eligible original payments/debits. Audit immutable entries.

## 6. Owner scopes, reporting and anti-bugs
- Server-derived `ownerId` filters every entity and join; database grants deny unauthenticated public queries; custom JWT does not automatically engage Supabase RLS.
- Do not join raw customer and wallet line items together for totals: that multiplies rows. Group each ledger separately then join aggregate results once per booking.
- `signed_due = ticket_price + fee - receipts_net`; positive due / negative customer credit.
- `wallet_net_deducted = booking_debits - associated_wallet_refunds_and_reversals`; distinct from customer due.
- `wallet_available = opening + credits - debits` (with reconciled cache if used).
- Fee is **billed revenue** until collected and costs considered; do not label it automatically as realized profit.
- The app is NOT a train ticket reservation/checking tool. It stores no PNR, references, passengers or ticket status.

## 7. Minimum integration test fixtures
- Operator A/B, packager A/B, wallets A/B, ticket bookings, partial receipts and refund entries.
- One create with ₹10,000 price, ₹1,000 fee, ₹8,500 collected, ₹10,000 wallet deducted ⇒ **₹2,500 due**.
- Same idempotency key two parallel POSTs ⇒ exactly one booking, one receipt, one wallet debit.
- Two wallet debits racing against insufficient combined balance ⇒ one fails, never negative.
- Cross-owner referenced `packager_id` / `wallet_id` / `booking_id` ⇒ rejected without data leak.
- Expired/JWT-wrong-claims/revoked session ⇒ 401; refresh token reuse ⇒ family revoke.

## Documentation references
- https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/multi-schema
- https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql
- https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference
- https://supabase.com/docs/guides/database/connecting-to-postgres
