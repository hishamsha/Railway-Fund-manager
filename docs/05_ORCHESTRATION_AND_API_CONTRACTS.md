# Node.js/Express Orchestration and REST API Contracts

**Replaces direct `supabase_flutter` and PostgreSQL RPC client calls.** Flutter sends HTTPS REST requests to Node.js/Express with backend-issued JWT Bearer credentials. Backend signs/verifies JWT, performs owner-scoped transactions and persists data in **Supabase PostgreSQL only**.

## 1. Standard API conventions

- Base URL: `https://<your-api-host>/api/v1` (configure from **non-secret** app setting).
- Content type: `application/json` with UTF-8; use money **integer paise** over API (e.g. 850000 paise for ₹8,500).
- Authentication: `Authorization: Bearer <access_jwt>` on all endpoints except login/refresh/health.
- Header `Idempotency-Key: <UUID>` **required** for money-changing POST commands.
- Authorization: `owner_id` derived from verified JWT `sub`; ignored/rejected if client supplies it.
- Pagination: `limit` (server-capped) and opaque cursor for lists; filter/sort constrained to allowlisted columns.
- API errors: `{ "error": { "code": "...", "message": "...", "fields": {}, "request_id": "..." } }`.
- Do not expose internal DB UUID as a user-supplied booking reference; IDs are allowed as opaque API keys.

## 2. Endpoint inventory

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | Minimal uptime indicator, no secrets |
| `POST` | `/auth/login` | Public, rate-limited | Argon2id password verification, JWT + opaque refresh |
| `POST` | `/auth/refresh` | Refresh token | Atomic refresh rotation |
| `POST` | `/auth/logout` | Access JWT | Revoke session and refresh chain |
| `GET` | `/auth/me` | Bearer JWT | Current owner profile |
| `POST` | `/auth/change-password` | Bearer JWT + old password | Replace password hash/revoke sessions |
| `GET/POST` | `/packagers` | Bearer JWT | Owner-scoped list/create |
| `GET/PATCH` | `/packagers/{id}` | Bearer JWT | Detail/edit/archive (no hard deletion) |
| `GET/POST` | `/bookings` | Bearer JWT | List / atomic new booking |
| `GET` | `/bookings/{id}` | Bearer JWT | Booking + financial summary |
| `PATCH` | `/bookings/{id}` | Bearer JWT + idempotency | Edit booking fields and audited financial totals with stale-edit checks |
| `POST` | `/bookings/{id}/collections` | Bearer JWT + idempotency | Append customer receipt |
| `POST` | `/bookings/{id}/customer-refunds` | Bearer JWT + idempotency | Actual packager refund |
| `POST` | `/finance/{entryId}/reverse` | Bearer JWT + idempotency | Audited correction of eligible entry |
| `GET/POST` | `/wallets` | Bearer JWT | List and create wallet |
| `GET` | `/wallets/{id}/entries` | Bearer JWT | Wallet ledger |
| `POST` | `/wallets/{id}/top-ups` | Bearer JWT + idempotency | Append wallet credit |
| `POST` | `/wallets/{id}/booking-debits` | Bearer JWT + idempotency | Deduct for booking |
| `POST` | `/wallets/{id}/refunds` | Bearer JWT + idempotency | Actual provider wallet refund |
| `GET` | `/dashboard` | Bearer JWT | Authenticated metrics |
| `GET` | `/reports/bookings` | Bearer JWT | Booking report with filters |
| `GET` | `/reports/collections` | Bearer JWT | Receipt/refund report |
| `GET` | `/reports/wallets` | Bearer JWT | Wallet cashflow report |
| `GET` | `/packagers/{id}/statement` | Bearer JWT | Packager statement |

Most PATCH requests should also accept an idempotency key/version check where a retry could create ambiguity; financial commands **must**. CSV/XLSX/PDF can be produced locally by Flutter from authorized paginated/streamed API responses with explicit row limits.

## 3. Auth request contracts

### `POST /auth/login`

```json
{ "email": "owner@example.com", "password": "<provided securely>" }
```

Response (shape; tokens are placeholders):

```json
{
  "access_token": "<signed-RS256-JWT>",
  "token_type": "bearer",
  "expires_in": 600,
  "refresh_token": "<single-use-random-opaque-token>",
  "user": { "id": "<uuid>", "email": "owner@example.com", "display_name": "Owner" }
}
```

Server stores **Argon2id password hash, hashed refresh token and revocable session** in PostgreSQL. It does not call Supabase Auth. Refresh endpoint accepts `{ "refresh_token": "..." }`, rotates it once and returns tokens with the same envelope (user may be omitted). Logout revokes server session. No signup endpoint.

### Protected request

```http
GET /api/v1/bookings?limit=20 HTTP/1.1
Authorization: Bearer <jwt>
```

Backend verifies JWT signature/algorithm, `iss`, `aud`, `exp`, `nbf`, `sub`, `sid` and current DB session before returning owner-scoped rows.

## 4. Create booking (one atomic finance operation)

```http
POST /api/v1/bookings HTTP/1.1
Authorization: Bearer <jwt>
Content-Type: application/json
Idempotency-Key: 54f3fe02-2677-4180-ac3e-f12db7dfc13e
```

```json
{
  "packager_id": "<uuid>",
  "boarding_station": "Kozhikode",
  "destination_station": "Chennai",
  "journey_date": "2026-10-25",
  "train_identifier": "12626",
  "ticket_price_paise": 1000000,
  "service_charge_paise": 100000,
  "initial_collected_paise": 850000,
  "wallet_deducted_paise": 1000000,
  "wallet_id": "<uuid>"
}
```

One input for train name or number. `wallet_id` may be null only if `wallet_deducted_paise == 0`. **No PNR, status, booking reference or passenger list.**

Successful `201 Created` or idempotent replay `200 OK`:

```json
{
  "booking": {
    "id": "<internal-uuid>",
    "packager_id": "<uuid>",
    "boarding_station": "Kozhikode",
    "destination_station": "Chennai",
    "journey_date": "2026-10-25",
    "train_identifier": "12626"
  },
  "financials": {
    "ticket_price_paise": 1000000,
    "service_charge_paise": 100000,
    "total_payable_paise": 1100000,
    "collected_paise": 850000,
    "wallet_deducted_paise": 1000000,
    "signed_balance_paise": 250000,
    "balance_due_paise": 250000,
    "advance_credit_paise": 0
  }
}
```

**Backend sequence inside one transaction:**
1. Authenticate JWT and live session, derive owner.
2. Validate all fields and same-owner packager/wallet.
3. Claim unique `(owner_id, idempotency_key)` with operation name and canonical payload hash; return prior result for identical replay, 409 for mismatch.
4. If wallet debit > 0, lock wallet parent row and compute **fresh** available balance; reject insufficient funds.
5. Insert booking.
6. Append initial receipt if amount > 0; append wallet debit if amount > 0.
7. Write audit event and committed result for deduplication.
8. Commit; query or compute authoritative result; return 201.

No transaction partial success; malformed JWT, invalid wallet or insufficient funds insert **nothing**.

## 5. Later collection

```http
POST /api/v1/bookings/<id>/collections
Authorization: Bearer <jwt>
Idempotency-Key: <stable-uuid>
```

```json
{ "amount_paise": 250000, "method": "upi", "occurred_at": "2026-10-25T10:00:00Z", "note": "Final settlement" }
```

Validate positive amount and booking ownership. Append receipt and audit; return updated `collected_paise`, `balance_due_paise`, `advance_credit_paise` and transaction ID. Receipts do not update the booking wallet.

## 6. Other write bodies (conceptual)
| Endpoint | Core inputs | Guard |
|---|---|---|
| `/wallets` create | `name`, `opening_balance_paise` | ≥0, owner from JWT |
| `/wallets/{id}/top-ups` | `amount_paise`, `occurred_at`, `note` | >0, same owner, append credit |
| `/wallets/{id}/booking-debits` | `booking_id`, `amount_paise` | >0, same-owner booking and wallet, locked sufficient balance |
| `/wallets/{id}/refunds` | `booking_id`, `amount_paise`, original entry ref | Cannot exceed eligible original debit after prior refunds |
| `/bookings/{id}/customer-refunds` | `amount_paise`, `reason`, `method` | Actual refund, cannot exceed eligible net collected |
| `/finance/{entryId}/reverse` | `reason`, original entry ID | Linked reversal; cap against prior reversal |
| `/bookings/{id}/journey` | Stations, date, one train identifier | Cannot silently modify ticket price/fee/history |

## 7. Read responses
All read requests are authenticated and owner scoped; response totals computed using preaggregated money ledgers. Use `/dashboard?from_date=...&to_date=...&clock=created_at|journey_date` to make metric semantics clear; fund and wallet activity reports filter by actual occurrence timestamps. APIs paginate large histories and enforce limits; exports must not leak other owners' transactions.

## 8. Flutter service orchestration
- Login: `AuthRepository` calls `/auth/login`; `TokenStore` saves refresh securely; `AuthController` updates route state.
- Request interceptor injects in-memory access JWT; on 401, **single-flight** refresh attempts once (excluding login/refresh routes); replays original call once with unchanged idempotency key/body.
- Financial Save controller generates one UUID key, awaits confirmed success, invalidates Riverpod providers and navigates to returned booking.
- On permanent 401/revocation, clear local tokens and route to Login. Do not show cached financial data as authenticated current state.
- Repository never directly accesses Supabase, signs JWT or supplies client owner ID.

## 9. Error codes and retry policy

| HTTP | Error code | UI action |
|---|---|---|
| 400/422 | `VALIDATION_ERROR` | Highlight invalid fields |
| 401 | `INVALID_CREDENTIALS`, `TOKEN_INVALID`, `SESSION_REVOKED` | Auth message / clear session after refresh failure |
| 403/404 | `FORBIDDEN` / `NOT_FOUND` | Hide other-owner resource |
| 409 | `IDEMPOTENCY_CONFLICT` | Do not repeat with changed payload |
| 409 | `INSUFFICIENT_WALLET_BALANCE` | Correct wallet or amount |
| 409 | `STALE_UPDATE` | Reload edited data |
| 429 | `RATE_LIMITED` | Respect backoff/Retry-After |
| 500/503 | `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE` | Keep same idempotency key; show retry |

## 10. API invariants
Never trust client-side money preview or wallet balance. Never accept direct financial SQL from Flutter. Never process partial booking creation. Never use Supabase Auth JWT as the API identity. Never issue a new idempotency key for network retries. Use structured API schema tests and OpenAPI snapshots to keep mobile/backend contracts aligned.

## Node/Express implementation mapping
- `routes` → Express router; `controller` → Zod validation + transport mapping; `service` → permissions and business transactions; `repository` → Prisma ORM queries.
- Use `asyncHandler` / centralized Express error middleware and typed `req.auth` set only by server-side JWT middleware.
- API BigInt/paise serialization must be explicit; return integer JSON paise within safe bounds or agreed decimal strings (never float rupees).
- API contracts are otherwise unchanged from the previous edition; the transaction boundary is now Prisma `$transaction` rather than a Python database unit of work.
- Never expose your Prisma database URL or any JWT signing private key to Flutter.
