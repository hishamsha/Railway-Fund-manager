# Train Fund Manager

Fund tracking for an operator handling bulk train-ticket requests from packagers. The original product plan is in [`docs/00_README_START_HERE.md`](docs/00_README_START_HERE.md). M00–M09 application flows are implemented through the Flutter app and Express API. Release QA and deployment still need environment-specific checks.

## Architecture

`mobile/` is the primary Flutter application. It uses authenticated REST calls to `backend/`, a Node.js/Express/TypeScript API with Prisma. Supabase provides PostgreSQL only; the app never connects to it directly. `web/` is the React and Vite admin page for the owner. Money is stored as integer paise, with customer receipts separate from operator wallet movements.

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

Requires Flutter with Android tooling/emulator or a connected device. The app uses the hosted Render API by default:

```powershell
cd mobile
flutter.bat pub get
flutter.bat run
```

The default API is `https://train-fund-manager-api.onrender.com/api/v1`, backed by the Supabase database. For local backend development in an Android emulator, explicitly pass `--dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1`. Access JWTs stay in app memory; Flutter stores only the rotating refresh token in platform secure storage, never the password. Settings can change the password with the current password. For a forgotten password, an administrator can run `npm run owner:recovery-code` in `backend` against the database and provide the one-time code for **Forgot password?** on login or **Forgot current password?** in Settings. A successful reset signs out all sessions and returns the app to login.

The only retained APK is the 64-bit Android profile build at `mobile/build/app/outputs/flutter-apk/app-arm64-v8a-profile.apk` (32.7 MB). It is an optimized, test-signed development artifact, not a signed production release. The APK contains the hosted Render API URL and has been verified to exclude the emulator API URL.

## Run the web admin

`web/` is the owner's admin page, built with React and Vite. It covers today's journeys and dues, the calendar, journey requests, bookings, the ticket tracker, payments and credit, agencies and their logins, booking accounts and service charges. Agency logins are refused here; the agency portal has an API but no screens yet. Editing or refunding a booking is not in this page yet.

Start the API, then in a second terminal:

```powershell
cd web
npm.cmd ci
npm.cmd run dev
```

Open `http://localhost:3001`. The Vite server forwards `/api` to `http://127.0.0.1:3000`; set `BACKEND_URL` to use another API. The access token stays in memory and the refresh token is kept for that browser tab only.

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
npm.cmd test
npm.cmd run build
```

See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for verification status and [`docs/RELEASE_RUNBOOK.md`](docs/RELEASE_RUNBOOK.md) for hosting, signing and recovery steps.

## Development database and authentication

A separate Supabase development project has the `app` schema migrations and a restricted `app_runtime` role. The local `.env` and `.env.migrate` use its TLS verified Session pooler, with distinct runtime and privileged credentials. `npm.cmd run db:verify-runtime` checks the role, and `npm.cmd run db:reconcile` checks ledger invariants. The real database integration tests run with `npm.cmd test` when both environment files are present. Example files document each variable.

`POST /api/v1/auth/login`, `/refresh`, `/logout`, `/change-password`, `/reset-password` and `GET /api/v1/auth/me` are implemented. The first development owner was created interactively and login, `/me`, refresh and logout were verified against the local API. No password is stored in the repository or mobile app. There is no public signup endpoint.

Prisma migrations create the private `app` schema tables in Supabase. Run `npm.cmd run db:inventory` from `backend/` to see exact row counts without exposing credentials. Packagers, bookings, wallets and their ledgers are persisted there when entered through the app; the development database currently has no business records yet.
