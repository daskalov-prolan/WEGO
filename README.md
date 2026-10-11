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

## Not included yet

Production hosting and HTTPS setup, single sign-on with Microsoft 365, public holidays, half vacation days,
vacation carried over from the previous year.
