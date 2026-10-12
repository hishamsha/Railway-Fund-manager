# Node.js + Express.js + TypeScript Backend Implementation

**Version 5.0.** This **replaces** the former FastAPI backend guide. Supabase remains **PostgreSQL hosting only**. Node runs the login server, JWT verification, authorization, financial services and reporting API.

## 1. File tree

```text
backend/
├── package.json
├── package-lock.json
├── tsconfig.json
├── eslint.config.js
├── .env.example
├── Dockerfile
├── prisma.config.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/              # checked-in Prisma Migrate SQL
├── generated/prisma/           # generated, not manually edited
├── src/
│   ├── main.ts                  # starts HTTP listener, graceful shutdown
│   ├── app.ts                   # Express setup, middleware, routes
│   ├── config/env.ts            # Zod-validated server-only configuration
│   ├── database/prisma.ts       # PrismaPg connection adapter, PrismaClient
│   ├── middleware/
│   │   ├── authenticate.ts      # JWT + DB session verification
│   │   ├── error-handler.ts
│   │   ├── request-id.ts
│   │   ├── rate-limiter.ts
│   │   └── validate.ts
│   ├── security/
│   │   ├── jwt.ts               # jose RS256 sign/verify with kid
│   │   ├── passwords.ts         # argon2id hash/verify
│   │   ├── random-tokens.ts     # crypto.randomBytes, sha256 hash
│   │   └── current-user.ts
│   ├── modules/
│   │   ├── auth/                # login, refresh, logout, me, password change
│   │   ├── packagers/           # CRUD/archive/search
│   │   ├── bookings/            # one train identifier + journey and price
│   │   ├── collections/         # receipts/refunds/reversals
│   │   ├── wallets/             # opening credit, topups, debits/refunds
│   │   ├── reports/             # dashboard, reconciliation, exports
│   │   └── audits/              # immutable audit metadata
│   ├── shared/
│   │   ├── money.ts             # bigint paise and limits
│   │   ├── serialize.ts         # explicit BigInt JSON conversion
│   │   ├── idempotency.ts       # stable key + payload hash handling
│   │   ├── errors.ts            # stable API error codes
│   │   └── pagination.ts
│   └── scripts/bootstrap-owner.ts
└── tests/
    ├── unit/
    ├── integration/             # real isolated Postgres, not production
    └── concurrency/
```

Feature module convention: `<feature>.routes.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, `<feature>.repository.ts`, `<feature>.schema.ts`, `<feature>.types.ts` and tests. **Controller** validates/dispatches; **service** owns business rules; **repository** handles Prisma queries; only service coordinates financial transaction boundaries. Avoid generic god-services.

## 2. Dependencies and runtime rules
- Node.js LTS, Express, TypeScript, Zod, `jose`, `argon2`, Prisma ORM + `@prisma/adapter-pg` + `pg`, `helmet`, `express-rate-limit`, `dotenv`. Use `tsx` for development and Vitest/Supertest for tests.
- Pin and commit compatible dependency versions and `package-lock.json`; run `npm ci` in CI/production.
- Add a central Express error handler, HTTP request limits, `helmet`, strict JSON parsing, correlation ID, log redaction, rate limits, and `/health` vs `/ready` separation.
- When backend and Flutter run on separate networks, use HTTPS. CORS is relevant only if a browser frontend is later added; it is not authorization.
- `process.env` must be validated at boot. Never silently run with unknown JWT key, wildcard origins when using cookies, or an unrestricted database account.

## 3. Prisma connection for version 7

```ts
// src/database/prisma.ts (conceptual, use installed generated-client path)
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is missing");
const adapter = new PrismaPg({ connectionString: url });
export const prisma = new PrismaClient({ adapter });
```

Use **separate** `MIGRATION_DATABASE_URL` in Prisma config and `DATABASE_URL` in runtime. When using PostgreSQL transaction-pooler mode, read official Supabase/Prisma adapter guidance and verify prepared-statement limitations; for a persistent Node service prefer direct or session pooling. Keep pools small and TLS properly verified.

## 4. JWT signing with jose (illustrative logic)

```ts
// Conceptual only; real implementation loads PEM via secret manager and validates env.
import { SignJWT, jwtVerify, importPKCS8, importSPKI } from "jose";

// Login: after Argon2id password verify and server session creation.
// const key = await importPKCS8(privatePem, "RS256");
// const access = await new SignJWT({ sid: sessionId, typ: "access" })
//   .setProtectedHeader({ alg: "RS256", kid: activeKid })
//   .setIssuer(issuer).setAudience(audience).setSubject(userId)
//   .setIssuedAt().setNotBefore("0s").setExpirationTime("10m")
//   .setJti(crypto.randomUUID()).sign(key);
// Protected routes: resolve known 'kid' from *trusted* key set, not arbitrary URL.
// await jwtVerify(access, publicKey, { algorithms: ["RS256"], issuer, audience });
```

Also verify `typ`, `sub` UUID, `sid` UUID, token expiry, current user activation and live `auth_sessions` row. No signing from Flutter. Authentication errors must be generic and not expose account existence.

## 5. Auth API specification

| Route | Input | Behavior |
|---|---|---|
| `POST /api/v1/auth/login` | `email`, `password` | Check Argon2id; persist session; return JWT + opaque refresh |
| `POST /api/v1/auth/refresh` | `refresh_token` | Hash input, lock token/session, atomic rotate; return replacement pair |
| `POST /api/v1/auth/logout` | Access JWT | Revoke current session; client clears token |
| `GET /api/v1/auth/me` | Access JWT | Return authenticated operator profile |
| `POST /api/v1/auth/change-password` | Access JWT, current/new | Verify; rehash; revoke other sessions |

Bootstrap owner with a **server-only CLI** (`npm run owner:bootstrap`) and secure interactive prompt; no public registration. Generate refresh token using `node:crypto` secure randomness (`randomBytes(32)` minimum), store only SHA-256 hash, and compare securely. Session family reuse detection is required. On token refresh, lock relevant DB rows, rotate and commit exactly once. If concurrent refresh returns uncertain after network failure, prefer requiring fresh login over uncontrolled token reuse. Flutter refresh requests are single-flight.

## 6. API middleware and authorization

```ts
// Flow; types omitted deliberately
// const claims = await verifyAccessJWT(req.header('authorization'));
// const session = await prisma.authSession.findFirst({
//   where: { id: claims.sid, userId: claims.sub, revokedAt: null }
// });
// if (!session || session.absoluteExpiresAt <= new Date()) throw unauthorized();
// req.auth = { userId: claims.sub, ownerId: claims.sub, sessionId: claims.sid };
```

Every protected service query scopes `ownerId` from verified server context. Never accept caller-supplied `owner_id` for database authorization. Cross-owner IDs should yield the same 404 semantics as nonexistent IDs. Check packager and wallet ownership inside the *same* transaction as booking writes.

## 7. Atomic booking operation
1. Parse Zod DTO and convert integer paise to validated BigInt; reject unknown keys (including PNR, booking status/reference and passenger details).
2. Authenticate and derive `ownerId`; validate packager owner and wallet owner.
3. Require `Idempotency-Key` UUID; hash canonical route+payload and claim unique `operation_requests` row inside transaction.
4. Lock wallet row for changes (`SELECT ... FOR UPDATE` via safe `tx.$queryRaw` or equivalent); check available funds using current ledger/cached guarded balance.
5. Create booking with one `train_identifier`, journey details and prices.
6. Append initial actual receipt to `customer_fund_entries` if nonzero; append wallet debit to `wallet_entries` if nonzero, update wallet balance if using guarded cache.
7. Insert audit event, store response in operation record and commit. On failure rollback all steps. On duplicate same key+payload return existing response; different payload returns 409.
8. Aggregate payable/collected/balance/wallet deducted **without joining two detail ledgers before grouping**; return committed result.

### Prisma interactive transactions and raw locks

```ts
import { Prisma } from "../../generated/prisma/client";

await prisma.$transaction(async (tx) => {
  // Example: owner-scoped row lock, no string interpolation of identifiers.
  await tx.$queryRaw`SELECT id FROM app.wallets WHERE id = ${walletId}::uuid AND owner_id = ${ownerId}::uuid FOR UPDATE`;
  // Check wallet balance, perform booking/ledgers/audit/idempotency under this transaction.
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```

Use a **bounded retry** for recognized serialization/deadlock errors after confirming official Prisma error codes; preserve the original idempotency key. Only financial commands use retries and only on transient transaction failures. No client-controlled change to posted ledger rows. Because Prisma maps Postgres bigint to JS BigInt, explicitly convert to **safe numeric JSON integer paise** within documented API limits or decimal-string fields. Never rely on JSON.stringify(BigInt), IEEE-754 floats or `parseFloat()` for money.

## 8. Operations and reporting
- `POST /api/v1/wallets/{id}/top-ups`, `POST /api/v1/bookings`, `POST /api/v1/bookings/{id}/collections` and every reversal/refund require idempotency and append-only records.
- Maintain clear audit events with actor, reason and nonsecret metadata.
- `GET /api/v1/bookings/{id}` returns both ledger histories and computed signed due. Financial edits to price/fee require audit and recalculation but must not rewrite receipts or wallet debits.
- Add read-only reconciliation command: sum wallet entries and compare guarded balance; aggregate receipt entries to booking/packager statements and dashboard, log mismatches and block release.
- OpenAPI 3 contract is maintained from route/Zod schemas with tooling chosen at implementation; keep examples in `05_ORCHESTRATION_AND_API_CONTRACTS.md` in sync.

## 9. Test gates
- JWT: correct/wrong password, expired/future claims, wrong key/alg/issuer/audience, revoked sessions and refresh reuse.
- Owner isolation: every foreign ID in read/update/create/transaction paths.
- Finance: ₹10,000 + ₹1,000 - ₹8,500 = ₹2,500 due; wallet ₹10,000 deduction independent; overpayment credit.
- Retry: same idempotency key+payload creates one result; different payload 409; concurrent duplicates safe.
- Wallet: two concurrent debits cannot overdraw, refund/reversal caps, rollback on failed debit.
- Backend: strict Zod validation; no leaked auth secrets/SQL details, snapshots of money JSON contract.

## Sources
- https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql
- https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/multi-schema
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://github.com/panva/jose
