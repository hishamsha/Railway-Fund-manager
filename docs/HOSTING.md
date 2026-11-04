# Hosting

The live site is one Render web service. It runs the API and serves the web app at the same address. Data lives in a Supabase PostgreSQL project. You create both accounts and handle every password yourself. Nothing in these steps goes in a chat or in Git.

## Before you start

- **Costs change, so check each provider's pricing page.** Free plans suit a trial only. Render's free service sleeps when idle, so the first visit can take about a minute. Supabase's free project can pause after a period of inactivity and has limited backups. Use paid plans before relying on this for real money records.
- **The GitHub repository is public.** That is fine for the code, because no secrets are in it, but anyone can read it.

## 1. Create the database

1. Create an account at supabase.com and a new project. Choose the Mumbai region and save the database password in a password manager.
2. In **Project Settings → Database**, download the **SSL certificate** and save it as `backend/.secrets/production/prod-ca-2021.crt`. Create the folder if needed. Git ignores it.
3. Open **Connect** and copy the **Session pooler** connection string. Put your database password in place of `[YOUR-PASSWORD]`, and URL-encode any special characters in it.

## 2. Run the setup script

In your own terminal, from `backend/`:

```powershell
npm.cmd run hosted:setup
```

Paste the connection string when asked; it stays hidden. The script checks the database, creates the restricted `app_runtime` role, applies all migrations and permissions, creates sign-in keys and creates your owner login. It is safe to run again. Its output files are in `backend/.secrets/production/`.

## 3. Create the web service

1. Create an account at render.com and connect GitHub so it can read `hishamsha/Railway-Fund-manager`.
2. Choose **New → Blueprint**, select the repository and the `master` branch, and confirm the plan.
3. When asked for `DATABASE_URL`, paste the contents of `render-database-url.txt`.
4. In the service's **Environment → Secret Files**, add these three files from `backend/.secrets/production/`, with exactly these names:
   - `prod-ca-2021.crt`
   - `jwt-private.pem`
   - `jwt-public.pem`
5. Deploy. The first build takes several minutes.

## 4. Check the live site

Open the address Render gives you, then:

1. `/ready` shows `{"status":"ready"}`.
2. Sign in with the owner login from step 2.
3. Create a test agency and a login for it, set its password in a private window, and confirm it sees only its own data.

## After launch

- **Database changes:** a new migration is not applied by deploying. Before deploying code that needs one, run `npm.cmd run hosted:setup` again, which also reapplies permissions.
- **Backups:** set these up before entering real records, and test restoring one. See `RELEASE_RUNBOOK.md`.
- **Time zone:** keep the database in UTC. The setup script refuses anything else, because recovery and setup code expiry depends on it.
- **Rate limits:** `TRUST_PROXY_HOPS` must match the number of proxies in front of the service. Check this after the first deploy.
