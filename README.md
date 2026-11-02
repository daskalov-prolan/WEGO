# WEGO Personaleinsatzplanung

Web application that replaces the Excel sheet for staff scheduling on construction sites:
one row per day, one column per employee, for the whole calendar year.

- Each day cell holds the customer (construction site) the employee works at. A day can be split into
  several entries with time windows, e.g. 8–10 Familie Schulze, 11–13 Familie Meier, 13–16 Familie Werner.
- Vacation and sick days are entered in the same cells; Berlin school holidays are shown next to the date.
- Two roles: **Planer** can change the plan, **Mitarbeiter** can only read it.
- Reports: per construction site (days worked, by whom) and per employee (where they worked).
- Vacation days used and remaining are visible only to planners and to the employee concerned.

## Structure

| Path | Content |
|---|---|
| `src/Wego.Api` | ASP.NET Core minimal API (.NET 10), EF Core, PostgreSQL, cookie login |
| `src/Wego.Web` | React + TypeScript (Vite) |
| `tests/Wego.Api.Tests` | API tests against a real PostgreSQL database (`wego_test`) |
| `docker-compose.yml` | PostgreSQL 17 for development |

## Run locally

Requires .NET SDK 10, Node.js 24 and Docker.

```
docker compose up -d
dotnet run --project src/Wego.Api --launch-profile http
cd src/Wego.Web
npm install
npm run dev
```

Open http://localhost:5173 and sign in with `planer` / `wego-dev-2026`. This first planner account is created
from `Seed:*` in `appsettings.Development.json` as long as no account exists; create all others under
**Verwaltung**. In development the database is migrated on startup (`Database:MigrateOnStartup`).

## Employees and sites from the live system

`tools/sync-from-live` copies employees and construction sites from https://planer.wego-badcenter.de into the
local application, through the API and with your own planner account there. No SSH or server access is needed.
Plan entries, vacation and sick days are not copied, and neither are logins. Nothing is deleted locally.

```
# PowerShell, with the local API running
$env:WEGO_LIVE_USER = "<your user name>"; $env:WEGO_LIVE_PASSWORD = "<your password>"
node tools/sync-from-live/sync.mjs           # dry run: lists what would change
node tools/sync-from-live/sync.mjs --apply   # writes to the local application
```

## Tests

```
dotnet test                 # needs the PostgreSQL from docker compose
cd src/Wego.Web
npm test
npm run lint
npm run build
```

## Database changes

```
dotnet ef migrations add <Name> --project src/Wego.Api
```

## Rules built into the application

- Vacation and sick days are counted Monday to Friday, one per day; public holidays are not deducted yet.
- A "Einsatztag" in the reports is a day on which an employee was scheduled at the site, also on split days.
  Hours are calculated only from entries that have a time window.
- School holidays are entered under **Verwaltung**, by hand or fetched from openholidaysapi.org (Berlin, `DE-BE`).
- Every change to the plan, an employee or a site is written to the table `ChangeLog`: when, by whom, and the
  record before and after as JSON. Nobody sees it in the application and no endpoint reads it; passwords and
  their hashes are never logged. To look at it on the server, e.g. everything since a point in time:

  ```
  cd /opt/wego
  docker compose exec db psql -U wego -c "SELECT \"ChangedAt\", \"ChangedBy\", \"Area\", \"Action\", \"EntityId\", \"Date\" FROM \"ChangeLog\" WHERE \"ChangedAt\" >= '2026-11-02 08:00+01' ORDER BY \"Id\";"
  ```

## Production

One Docker image (`Dockerfile`) on a Hetzner server with PostgreSQL and Caddy for HTTPS, deployed by hand with the
GitHub workflow **Deploy**. Setup and operation: [deploy/README.md](deploy/README.md).

## Not included yet

Single sign-on with Microsoft 365, public holidays, half vacation days,
vacation carried over from the previous year.
