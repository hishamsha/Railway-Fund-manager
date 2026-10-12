# Release and recovery runbook

The Flutter app is the primary client. It calls an HTTPS Express API. Only the API connects to the private Supabase PostgreSQL `app` schema. This document describes a release procedure; no production host or database has been provisioned.

## 1. Before staging

1. Rotate the development database password that was disclosed during setup. Update the ignored local migration secret; never paste it into chat or commit it.
2. Choose an API host, HTTPS domain and separate staging/production PostgreSQL projects. Use a restricted `app_runtime` database role for the API and a separate migration role for the deployment job.
3. Decide the Android application ID and create an upload signing key in a protected location. The generated `com.example.train_fund_manager` ID must be replaced before publishing.
4. A development owner has been created interactively. Before a hosted release, change the password that was shared in chat and provision the production owner through a secure terminal. No public signup route exists.

## 2. Backend build and deployment

`render.yaml` defines a Render Docker web service from `backend/` with a database-backed `/ready` health check. It selects Render's free plan for development; the service sleeps after idle time, so the first mobile request can take around a minute. Move to a paid instance before relying on prompt, continuous access.

For the existing development database, create a private GitHub repository, push this source, then create a Render Blueprint from the repository. Set the prompted `DATABASE_URL` to the **restricted** `app_runtime` Session pooler URI. Keep `schema=app` and `sslmode=verify-full`, but change `sslrootcert` from the Windows path in the ignored local `.env` to `/etc/secrets/prod-ca-2021.crt`. URL-encode the URI password. Do not use `MIGRATION_DATABASE_URL` as the service's runtime URL.

In the Render service's **Environment → Secret Files**, add these files from the ignored local copies:

- `prod-ca-2021.crt` → `/etc/secrets/prod-ca-2021.crt`
- `jwt-private.pem` → `/etc/secrets/jwt-private.pem`
- `jwt-public.pem` → `/etc/secrets/jwt-public.pem`

The Docker runtime user belongs to group `1000` so it can read Render secret files. The Render service must show a successful `/ready` check before building the phone APK. Rotate the disclosed development operator password and database password before using the project outside private testing.

From `backend/`, run `npm ci`, `npm run db:generate`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. `Dockerfile` builds the API with Node 22 and runs as the non-root `node` user. Build with `docker build -t train-fund-manager-api .`; deploy the resulting image behind a managed HTTPS endpoint.

Set `DATABASE_URL` to the restricted role's TLS-verified PostgreSQL URI. Provide `JWT_PRIVATE_KEY_FILE`, `JWT_PUBLIC_KEY_FILE` (or `JWT_PUBLIC_KEYS_JSON` for key rotation), `JWT_ACTIVE_KID`, `JWT_ISSUER`, and `JWT_AUDIENCE` as server-only secrets. Mount PEM and CA files outside the image. Set `NODE_EXTRA_CA_CERTS` when the platform does not trust the database certificate. Never put credentials or signing material in `mobile/`, image layers, CI logs or source control. The container exposes `/health` and database-backed `/ready`.

Run `npm run db:migrate:deploy` from a controlled migration job using `MIGRATION_DATABASE_URL`, not from every API instance. Then run `npm run db:verify-runtime` and `npm run db:reconcile`. The latter must report zero wallet mismatches, receipt/debit over-corrections and incomplete operations. Set alerts for `/ready` failure, 5xx rates, auth failures, and nonzero reconciliation.

For key rotation, first add both current and previous public PEMs to `JWT_PUBLIC_KEYS_JSON` keyed by `kid`. Switch `JWT_ACTIVE_KID` and the private PEM to the new pair. Retain the previous public key for at least the access-token lifetime, then remove it. Revoke sessions if a private key is compromised.

## 3. Backup and restore rehearsal

Before migrating production, take an encrypted, access-controlled PostgreSQL backup that includes `app` schema, auth sessions, ledger and audit tables. Use the privileged connection only inside the backup job. Verify its size and checksum. Preserve the corresponding migration version.

Restore the backup to a **new isolated database**, never over the live database. Run `pg_restore` there, compare table counts and migration version, then point an isolated API process at the restored database and run `npm run db:reconcile` plus read-only login/statement checks. Document the measured recovery time and data loss window. A restore rehearsal has not yet been run because an isolated restore target and credentials are not configured.

Do not undo a posted financial migration by deleting ledger rows. For code rollback, redeploy the prior API image only if it is schema-compatible; otherwise make a reviewed forward migration and rerun reconciliation.

## 4. Android build

Build an installable, arm64-only APK for testing **after** Render assigns the live HTTPS hostname. From the project root, run `mobile/tool/build-render-apk.ps1 -ApiBaseUrl https://YOUR_RENDER_HOST.onrender.com/api/v1`. The script requires HTTPS, builds only for arm64, and leaves one APK at `mobile/build/app/outputs/flutter-apk/app-arm64-v8a-profile.apk`. This profile APK uses test signing; the release build below requires a protected signing key. Profile and release builds reject a local HTTP API URL.

Set the application ID and version. Provide `TRAIN_FUND_KEYSTORE_PATH`, `TRAIN_FUND_KEY_ALIAS`, `TRAIN_FUND_STORE_PASSWORD`, and `TRAIN_FUND_KEY_PASSWORD` through the build environment. The release Gradle task rejects missing signing credentials. Build with:

```powershell
flutter.bat build appbundle --release --dart-define=API_BASE_URL=https://YOUR_API_DOMAIN/api/v1
```

The app refuses a non-HTTPS API URL in release mode. Only debug Android builds allow local cleartext traffic for `10.0.2.2`. Check the AAB/APK for database URLs, PEM files, development API URLs and debug signing. Install a signed build on a physical Android device and test login, session restore, packager, wallet top-up, booking, collection, correction, report export and logout. Test revocation and low-connectivity retries with the same idempotency key. A signed device acceptance run remains pending production API and signing credentials.

## 5. Operator handover

Store the owner password in a password manager. Customer due is payable minus net collections; wallet spending is a separate operator balance. Use refunds for real money returned, reversals for mistaken entries, and a mandatory reason for corrections. Review the packager statement and the report date clock before sharing exports. If a save times out, retry with the same details so the idempotency key remains stable.

## Local owner password recovery

If the operator cannot sign in, start the local API and run `cd backend` then `npm run owner:recovery-code` on the API computer. If more than one active operator exists, append `-- owner@example.com`. The command prints a one-time code valid for 15 minutes. On the Flutter login screen, tap **Forgot password?**, enter the operator email, code, and a new password of at least 12 characters. The code is stored as a hash in PostgreSQL and is cleared after use; all existing sessions are revoked. Treat terminal output containing the code as sensitive and do not paste it into chat or logs. This local procedure requires access to the API computer; a hosted deployment needs a separate verified delivery channel before remote recovery is possible.
