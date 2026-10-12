# Train Fund Manager

Fund tracking for an operator handling bulk train-ticket requests from packagers. The original product plan is in [`docs/00_README_START_HERE.md`](docs/00_README_START_HERE.md). M00–M09 application flows are implemented through the Flutter app and Express API. Release QA and deployment still need environment-specific checks.

## Architecture

`mobile/` is the primary Flutter application. It uses authenticated REST calls to `backend/`, a Node.js/Express/TypeScript API with Prisma. Supabase provides PostgreSQL only; the app never connects to it directly. `web/` is an additional Next.js client initialized with shadcn preset `b1e5uMopLE`, but it is currently behind the Flutter feature set. Money is stored as integer paise, with customer receipts separate from operator wallet movements.

## Run the API

Requires Node.js 22+.

```powershell
cd backend
npm.cmd ci
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path '.\prod-ca-2021.crt').Path
npm.cmd run dev
```

`GET http://localhost:3000/health` and `GET http://localhost:3000/api/v1/health` return `{ "status": "ok" }`. Check that `GET http://localhost:3000/ready` returns 200 before logging in from Flutter; `/health` alone does not test the database. The local Supabase certificate is required for verified TLS from this Node installation. The ignored local `backend/.env` contains only the restricted runtime database URL and paths to development signing keys. The privileged migration URL is isolated in ignored `backend/.env.migrate`. Never commit either file or the key files.

## Run the Flutter app

Requires Flutter with Android tooling/emulator or a connected device. Start the API in one terminal, then:

```powershell
cd mobile
flutter.bat pub get
flutter.bat run
```

The emulator can reach the local API at `http://10.0.2.2:3000/api/v1`; a physical phone needs a reachable HTTPS API URL. Configure `API_BASE_URL` using `--dart-define` for the chosen environment. A development owner account is now configured. Start the API before signing in on the emulator. Access JWTs stay in app memory; Flutter stores only the rotating refresh token in platform secure storage, never the password. Settings can change the password with the current password. For a forgotten password, run `npm run owner:recovery-code` in `backend` on the API computer and enter the one-time code through **Forgot password?** on login or **Forgot current password?** in Settings. A successful reset signs out all sessions and returns the app to login.

The only retained APK is the 64-bit Android profile build at `mobile/build/app/outputs/flutter-apk/app-arm64-v8a-profile.apk` (32.7 MB). It is an optimized development artifact, not a signed production release. Its default API URL (`10.0.2.2`) works only from an Android emulator; a physical phone needs a reachable API URL supplied with `--dart-define=API_BASE_URL=...` when building.

## Run the additional web app

Use two terminals:

```powershell
cd backend
npm.cmd run dev
```

```powershell
cd web
pnpm.cmd install
pnpm.cmd run dev
```

Open `http://localhost:3001/login`. `web/.env.example` shows the optional server-only `BACKEND_API_URL`; the default is `http://127.0.0.1:3000/api/v1`. The web client does not yet expose M07 collections and statements.

## Verify current code

```powershell
cd backend
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run db:reconcile
cd ../mobile
flutter.bat analyze
flutter.bat test
cd ../web
pnpm.cmd run typecheck
pnpm.cmd run lint
pnpm.cmd run build
```

See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for verification status and [`docs/RELEASE_RUNBOOK.md`](docs/RELEASE_RUNBOOK.md) for hosting, signing and recovery steps.

## Development database and authentication

A separate Supabase development project has the `app` schema migrations and a restricted `app_runtime` role. The local `.env` and `.env.migrate` use its TLS verified Session pooler, with distinct runtime and privileged credentials. `npm.cmd run db:verify-runtime` checks the role, and `npm.cmd run db:reconcile` checks ledger invariants. The real database integration tests run with `npm.cmd test` when both environment files are present. Example files document each variable.

`POST /api/v1/auth/login`, `/refresh`, `/logout`, `/change-password`, `/reset-password` and `GET /api/v1/auth/me` are implemented. The first development owner was created interactively and login, `/me`, refresh and logout were verified against the local API. No password is stored in the repository or mobile app. There is no public signup endpoint.

Prisma migrations create the private `app` schema tables in Supabase. Run `npm.cmd run db:inventory` from `backend/` to see exact row counts without exposing credentials. Packagers, bookings, wallets and their ledgers are persisted there when entered through the app; the development database currently has no business records yet.
