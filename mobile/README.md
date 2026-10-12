# Train Fund Manager for Android

The primary Flutter application calls the authenticated Express API. It never connects directly to Supabase PostgreSQL.

## Run locally

Start the backend from `../backend` with `npm.cmd run dev`, then run:

```powershell
flutter.bat pub get
flutter.bat run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

`10.0.2.2` reaches the host computer from an Android emulator. For a physical device, supply a reachable HTTPS API URL. Create the first owner interactively in `../backend` with `npm.cmd run owner:bootstrap`; there is no public signup.

## Implemented screens

Login/session restore, dashboard, packagers and statements, wallets and top-ups, booking list/create/detail, collection entry, corrections, transaction timeline, date-window reports with CSV/XLSX/PDF sharing, and settings/logout. Financial totals come from the API. Customer dues and wallet balances are displayed separately.

## Check

```powershell
flutter.bat analyze
flutter.bat test
```

The development owner account is configured and the local API login flow passes. Device login and session restore still need an emulator walkthrough. Signed release testing needs signing credentials and a hosted HTTPS API.
