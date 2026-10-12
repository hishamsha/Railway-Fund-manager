# Train Fund Manager for Android

The primary Flutter application calls the authenticated Express API. It never connects directly to Supabase PostgreSQL.

## Run the app

`flutter.bat run` uses `https://train-fund-manager-api.onrender.com/api/v1` by default. For development against the local backend in an Android emulator, start the backend from `../backend` with `npm.cmd run dev`, then run:

```powershell
flutter.bat pub get
flutter.bat run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

`10.0.2.2` reaches the host computer from an Android emulator. Profile and release builds require an HTTPS API URL. There is no public signup.

## Implemented screens

Login/session restore, dashboard, packagers and statements, wallets and top-ups, booking list/create/detail, collection entry, corrections, transaction timeline, date-window reports with CSV/XLSX/PDF sharing, and settings/logout. Financial totals come from the API. Customer dues and wallet balances are displayed separately.

## Check

```powershell
flutter.bat analyze
flutter.bat test
```

The hosted API's `/ready` endpoint has passed its Supabase database check. The arm64 profile APK contains its HTTPS URL. Device login and session restore still need a physical-device walkthrough; a production release also needs protected signing credentials.
