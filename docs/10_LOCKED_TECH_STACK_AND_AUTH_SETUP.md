# Locked Technology Stack & Custom JWT Authentication — Node.js Edition

**Version:** 5.0 · 11 October 2026. This file supersedes all Python/FastAPI design choices from the older version. The financial/business scope is unchanged.

## 1. Non-negotiable stack

| Layer | Locked choice | Responsibility |
|---|---|---|
| Mobile app | **Flutter (Dart)** | Android-first mobile UI |
| UI components | **`shadcn_ui` Flutter package** | Shadcn-style native Flutter components; not React shadcn/ui |
| State / routing / HTTP | Riverpod / GoRouter / Dio | Client state, navigation, REST communication |
| Secure storage | `flutter_secure_storage` | Opaque refresh token in OS protected storage; access JWT in memory |
| Backend | **Node.js LTS + Express.js + TypeScript** | Authentication, protected REST API, authorization, all financial writes |
| Request validation | **Zod** | Strict request DTOs and response contracts |
| JWT | **`jose` with RS256** | Signed short-lived access JWT verification/issuance; `kid` rotation |
| Passwords | **`argon2` (Argon2id)** | Password hash and verify, never plaintext |
| ORM | **Prisma ORM** | Typed database access, transactions and migrations |
| PostgreSQL adapter | `@prisma/adapter-pg` + `pg` | Prisma 7+ runtime connectivity |
| Database hosting | **Supabase PostgreSQL only** | Private `app` schema; users, sessions, packagers, bookings and ledgers |
| Testing | Vitest + Supertest + isolated PostgreSQL | Integration/auth/finance concurrency tests |
| Hosting | Managed Node.js HTTPS service | Environment secrets, logging, DB connection pool |

**Excluded:** Supabase Auth, Flutter Supabase SDK, Supabase API calls from the app, direct database connection from Flutter, Firebase, FastAPI, SQLAlchemy, Alembic, Laravel, NestJS, public self-signup, ticket provider APIs, PNR, train ticket statuses, passenger details and user-facing booking references.

## 2. Why the backend exists
Flutter is a public binary and cannot protect the database password or a JWT-signing private key. Node.js is the only client-accessible data/auth service. The Node backend validates login, signs JWT access tokens, checks active sessions and owner-scoped authorization, then opens TLS PostgreSQL connections with server-only credentials. Supabase is used exclusively as **hosted PostgreSQL**; its Auth and client-side Data API are not part of this app.

## 3. Monorepo setup

```bash
mkdir train-fund-manager && cd train-fund-manager
mkdir mobile backend docs
flutter create mobile
cd mobile
flutter pub add shadcn_ui flutter_riverpod go_router dio flutter_secure_storage intl
flutter pub add --dev flutter_lints
cd ../backend
npm init -y
npm install express zod jose argon2 @prisma/client @prisma/adapter-pg pg dotenv helmet cors express-rate-limit
npm install -D typescript tsx prisma @types/node @types/express @types/cors @types/pg vitest supertest @types/supertest eslint
npx tsc --init
npx prisma init --datasource-provider postgresql --output ../generated/prisma
```

**Version policy:** Use current mutually compatible stable Node LTS/Prisma versions at implementation time; pin `package-lock.json` and `pubspec.lock`. Prisma ORM v7 examples below are version-specific; if a future Prisma major changes config, follow its official migration guide rather than mixing versions. Prisma 7 uses the `prisma-client` generator, an explicit output path, a driver adapter at runtime, and datasource URLs in a Prisma config file, not `schema.prisma`.

## 4. Runtime environment (backend only)

```dotenv
# EXAMPLE ONLY. Values are placeholders, never real credentials.
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://app_runtime:REDACTED@DB_HOST:5432/postgres?schema=app
MIGRATION_DATABASE_URL=postgresql://app_migrator:REDACTED@DB_HOST:5432/postgres?schema=app
JWT_ISSUER=train-fund-manager-api
JWT_AUDIENCE=train-fund-manager-mobile
JWT_ACTIVE_KID=key-2026-01
JWT_PRIVATE_KEY_PEM=REDACTED
JWT_PUBLIC_KEYS_JSON=REDACTED
ACCESS_TOKEN_TTL_SECONDS=600
REFRESH_TOKEN_TTL_DAYS=14
LOGIN_RATE_LIMIT_PER_MINUTE=5
```

Prefer multiline PEM secrets as **mounted files/secret manager references**, rather than raw `.env` strings. Configure real DB URLs using the project's **Supabase Connect** screen, verify TLS certificates and choose **direct/session-pooler** for a persistent Node backend; confirm any transaction-pooler limitations before adopting it. Migrator credentials must never be in running web service environments. Limit `pg` pool sizing for the Supabase plan.

### Prisma v7 illustrative configuration

`backend/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
  schemas  = ["app"]
}

model AppUser {
  id              String @id @default(uuid()) @db.Uuid
  emailNormalized String @unique @map("email_normalized")
  passwordHash    String @map("password_hash")
  isActive        Boolean @default(true) @map("is_active")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  @@map("app_users")
  @@schema("app")
}
```

`backend/prisma.config.ts` (Prisma 7; newer CLI may generate `prisma7.config.ts`):

```ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.MIGRATION_DATABASE_URL },
});
```

**Only an illustrative model**, not the full schema. Use `03_DATABASE_SCHEMA_AND_SECURITY.md` and `13_PRISMA_SCHEMA_AND_TRANSACTION_PATTERNS.md` to implement all relations, constraints, indexes and ledgers. Do not run `prisma db push` on production; use reviewed and committed Prisma Migrate SQL. Set runtime adapter `new PrismaPg({ connectionString: process.env.DATABASE_URL! })` and instantiate the generated `PrismaClient({ adapter })`. Confirm ESM path/output for installed Prisma version.

## 5. Custom login and JWT strategy
1. A controlled `npm run owner:bootstrap` CLI creates the first operator; **no public `/register` endpoint**.
2. Store normalized email and **Argon2id** password hash in `app.app_users`.
3. `POST /api/v1/auth/login` verifies credentials, creates a revocable `auth_sessions` row, stores a SHA-256 hash of a 32+ byte cryptographically random refresh token, returns **RS256 access JWT** and raw opaque refresh token.
4. JWT includes `iss`, `aud`, `sub`, `sid`, `jti`, `iat`, `nbf`, `exp`, header `kid`, and payload `typ=access`; verifier fixes accepted algorithm and checks active `app_users` and `auth_sessions` records.
5. `POST /api/v1/auth/refresh` rotates refresh token **atomically and exactly once**; lock session/refresh record and detect reuse. Reuse revokes the session/family and requires login.
6. `POST /api/v1/auth/logout` revokes server session; Flutter deletes secure token. Changing password invalidates other sessions.
7. Send Bearer JWT only over HTTPS. Do not put personal/financial details into access JWTs. Rate-limit and monitor login/refresh endpoints.
8. Flutter holds access JWT in memory; opaque refresh token in `flutter_secure_storage`. Refresh is single-flight; protected 401 requests retry **at most once**, with unchanged idempotency keys.

A 10-minute access TTL and 14-day rolling refresh window are **initial parameters**, not guarantees. Enforce a server-defined absolute session expiry.

## 6. Supabase database-only restrictions
- Create a private PostgreSQL `app` schema; keep it out of exposed PostgREST schemas, or disable the Data API entirely where supported.
- Do not use `auth.users`, `auth.uid()`, Supabase JWT keys, Supabase Auth sessions or `supabase_flutter` in the app.
- Use a restricted runtime DB role with per-table privileges and a distinct migration/admin DB role; authorization still happens in the Node backend.
- Enable PostgreSQL RLS optionally as an independent defense-in-depth mechanism **only if** policies and trusted transaction-local owner context are correctly designed/tested. It is not automatically enforced by your custom JWT.
- DB and JWT signing secrets belong to server runtime; only `API_BASE_URL` is configured in Flutter.

## 7. Checklists
- [ ] `node` LTS, `npm ci`, `npx prisma generate`, `npx prisma migrate deploy` confirmed in controlled environment
- [ ] Prisma v7 adapter and `DATABASE_URL` / `MIGRATION_DATABASE_URL` separated
- [ ] Express starts with `/health` and clean shutdown of HTTP server + Prisma pool
- [ ] No email-password validation or wallet debits are trusted purely from Flutter
- [ ] JSON financial amounts are exact integer paise with explicit BigInt-to-JSON serialization
- [ ] JWT logout/revocation and refresh-token replay tests pass
- [ ] Supabase Auth unused; all HTTP database access is backend-mediated

## References
- https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql
- https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/multi-schema
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/secure-data
- https://pub.dev/packages/shadcn_ui
- https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html
