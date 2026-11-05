using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;
using static Wego.Api.Endpoints.PlanEndpoints;

namespace Wego.Api.Endpoints;

public static class SchoolHolidayEndpoints
{
    public const string OpenHolidaysClient = "openholidays";

    public record SchoolHolidayInput(string Name, DateOnly StartDate, DateOnly EndDate,
        HolidayKind Kind = HolidayKind.Schulferien);
    public record ImportResult(int Imported, int Total);

    // Response format of https://openholidaysapi.org/SchoolHolidays and /PublicHolidays
    private record OpenHoliday(DateOnly StartDate, DateOnly EndDate, List<OpenHolidayName>? Name);
    private record OpenHolidayName(string Language, string Text);

    /// <summary>
    /// The public holidays from <paramref name="from"/> to <paramref name="to"/>: those of Berlin (computed, also when
    /// not loaded) and the single days entered as Feiertag. They are free and never count as vacation.
    /// </summary>
    public static async Task<HashSet<DateOnly>> PublicHolidaysAsync(WegoDbContext db, DateOnly from, DateOnly to)
    {
        var days = new HashSet<DateOnly>();
        for (var year = from.Year; year <= to.Year; year++)
            days.UnionWith(BerlinHolidays.Of(year).Where(d => d >= from && d <= to));
        // A "Feiertag" over several days is a mistake in the entry (e.g. a closure of the wrong kind), not a holiday.
        days.UnionWith(await db.SchoolHolidays
            .Where(h => h.Kind == HolidayKind.Feiertag && h.StartDate == h.EndDate && h.StartDate >= from && h.StartDate <= to)
            .Select(h => h.StartDate)
            .ToListAsync());
        return days;
    }

    /// <summary>
    /// The working days of a company closure: Monday to Friday, without public holidays (they are free anyway).
    /// </summary>
    private static async Task<List<DateOnly>> ClosureDaysAsync(WegoDbContext db, SchoolHoliday closure)
    {
        var publicHolidays = await PublicHolidaysAsync(db, closure.StartDate, closure.EndDate);
        var days = new List<DateOnly>();
        for (var day = closure.StartDate; day <= closure.EndDate; day = day.AddDays(1))
            if (day.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday) && !publicHolidays.Contains(day))
                days.Add(day);
        return days;
    }

    /// <summary>
    /// Company closure: every active craftsman gets vacation on its working days. What was planned on those
    /// days gives way (the change log keeps it).
    /// </summary>
    private static async Task EnterClosureAsync(WegoDbContext db, ClaimsPrincipal user, SchoolHoliday closure)
    {
        var days = await ClosureDaysAsync(db, closure);
        var craftsmen = await db.Employees.Where(e => e.IsActive && e.ShowInPlan).Select(e => e.Id).ToListAsync();
        var replaced = await db.PlanEntries
            .Where(e => craftsmen.Contains(e.EmployeeId) && days.Contains(e.Date))
            .ToListAsync();
        db.PlanEntries.RemoveRange(replaced);
        foreach (var employeeId in craftsmen)
        {
            foreach (var day in days)
                db.PlanEntries.Add(new PlanEntry { EmployeeId = employeeId, Date = day, Type = EntryType.Urlaub });
            db.ClosureVacations.Add(new ClosureVacation { Holiday = closure, EmployeeId = employeeId });
        }
        ChangeLog.Add(db, user, ChangeArea.Plan, "Betriebsferien eingetragen", null,
            replaced.Select(e => new { e.EmployeeId, e.Date, e.Type, e.SiteId, e.Activity, e.StartTime, e.EndTime, e.Note }).ToList(),
            new { closure.Name, closure.StartDate, closure.EndDate, Employees = craftsmen.Count, Days = days.Count }, closure.StartDate);
    }

    /// <summary>Company closures from this day on are given to craftsmen who came later, too.</summary>
    public static readonly DateOnly ClosuresCaughtUpFrom = new(MyEndpoints.VacationCountedFrom, 1, 1);

    /// <summary>
    /// Every active craftsman gets the vacation of every company closure from <see cref="ClosuresCaughtUpFrom"/>
    /// on, also when he was added (or made active) after the closure was entered. Only free days are filled; what
    /// is planned stays. Each closure is given to each craftsman once.
    /// </summary>
    public static async Task CatchUpClosuresAsync(WegoDbContext db)
    {
        var closures = await db.SchoolHolidays
            .Where(h => h.Kind == HolidayKind.Betriebsferien && h.EndDate >= ClosuresCaughtUpFrom)
            .ToListAsync();
        if (closures.Count == 0) return;
        var craftsmen = await db.Employees.Where(e => e.IsActive && e.ShowInPlan).Select(e => e.Id).ToListAsync();
        var closureIds = closures.Select(c => c.Id).ToList();
        var given = (await db.ClosureVacations.Where(c => closureIds.Contains(c.HolidayId)).ToListAsync())
            .Select(c => (c.HolidayId, c.EmployeeId)).ToHashSet();

        var added = 0;
        foreach (var closure in closures)
        {
            var missing = craftsmen.Where(id => !given.Contains((closure.Id, id))).ToList();
            if (missing.Count == 0) continue;
            var days = (await ClosureDaysAsync(db, closure)).Where(d => d >= ClosuresCaughtUpFrom).ToList();
            var taken = (await db.PlanEntries
                    .Where(e => missing.Contains(e.EmployeeId) && days.Contains(e.Date))
                    .Select(e => new { e.EmployeeId, e.Date })
                    .ToListAsync())
                .Select(e => (e.EmployeeId, e.Date)).ToHashSet();
            foreach (var employeeId in missing)
            {
                foreach (var day in days.Where(d => !taken.Contains((employeeId, d))))
                {
                    db.PlanEntries.Add(new PlanEntry { EmployeeId = employeeId, Date = day, Type = EntryType.Urlaub });
                    added++;
                }
                db.ClosureVacations.Add(new ClosureVacation { HolidayId = closure.Id, EmployeeId = employeeId });
            }
        }
        if (added > 0)
            db.ChangeLog.Add(new ChangeLogEntry
            {
                ChangedAt = DateTime.UtcNow, ChangedBy = "automatisch (Betriebsferien)", Area = ChangeArea.Plan,
                Action = "Betriebsferien nachgetragen",
                After = System.Text.Json.JsonSerializer.Serialize(new { Days = added }),
            });
        await db.SaveChangesAsync();
    }

    /// <summary>The closure is taken back: the vacation it gave on its working days goes again.</summary>
    private static async Task RemoveClosureAsync(WegoDbContext db, ClaimsPrincipal user, SchoolHoliday closure)
    {
        var days = await ClosureDaysAsync(db, closure);
        var craftsmen = await db.Employees.Where(e => e.ShowInPlan).Select(e => e.Id).ToListAsync();
        var vacation = await db.PlanEntries
            .Where(e => e.Type == EntryType.Urlaub && craftsmen.Contains(e.EmployeeId) && days.Contains(e.Date))
            .ToListAsync();
        db.PlanEntries.RemoveRange(vacation);
        ChangeLog.Add(db, user, ChangeArea.Plan, "Betriebsferien gelöscht", null,
            new { closure.Name, closure.StartDate, closure.EndDate, Days = days.Count }, null, closure.StartDate);
    }

    public static void MapSchoolHolidayEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/schoolholidays").RequireAuthorization(Policies.Admin);

        group.MapPost("/", async (SchoolHolidayInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var name = input.Name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > 200)
                return ApiErrors.BadRequest("Bitte eine Bezeichnung mit höchstens 200 Zeichen angeben.");
            if (input.EndDate < input.StartDate)
                return ApiErrors.BadRequest("Das Ende darf nicht vor dem Beginn liegen.");
            if (!Enum.IsDefined(input.Kind)) return ApiErrors.BadRequest("Unbekannte Art.");
            if (input.Kind == HolidayKind.Feiertag && input.EndDate != input.StartDate)
                return ApiErrors.BadRequest("Ein Feiertag ist ein einzelner Tag. Für mehrere Tage bitte Betriebsferien oder Schulferien wählen.");

            var holiday = new SchoolHoliday
            {
                Name = name, Kind = input.Kind, StartDate = input.StartDate, EndDate = input.EndDate,
            };
            db.SchoolHolidays.Add(holiday);
            if (holiday.Kind == HolidayKind.Betriebsferien) await EnterClosureAsync(db, user, holiday);
            await db.SaveChangesAsync();
            return Results.Ok(new SchoolHolidayDto(holiday.Id, holiday.Name, holiday.Kind, holiday.StartDate,
                holiday.EndDate));
        });

        group.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var holiday = await db.SchoolHolidays.FindAsync(id);
            if (holiday is null) return Results.NotFound();
            db.SchoolHolidays.Remove(holiday);
            if (holiday.Kind == HolidayKind.Betriebsferien) await RemoveClosureAsync(db, user, holiday);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Loads the Berlin school holidays and public holidays of one year from the public OpenHolidays API.
        group.MapPost("/import", async (int year, WegoDbContext db, IHttpClientFactory httpClientFactory,
            ILoggerFactory loggerFactory) =>
        {
            try
            {
                return Results.Ok(await ImportYearAsync(db, httpClientFactory.CreateClient(OpenHolidaysClient), year));
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
            {
                loggerFactory.CreateLogger(nameof(SchoolHolidayEndpoints))
                    .LogWarning(ex, "Holiday import for {Year} failed", year);
                return Results.Problem("Die Ferien und Feiertage konnten nicht abgerufen werden.",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        });
    }

    /// <summary>
    /// Takes over the Berlin school holidays and public holidays of a year from the OpenHolidays API; what is there
    /// already (same kind and days) is left. Throws when the API cannot be reached.
    /// </summary>
    public static async Task<ImportResult> ImportYearAsync(WegoDbContext db, HttpClient client, int year)
    {
        var query = $"?countryIsoCode=DE&subdivisionCode=DE-BE&languageIsoCode=DE&validFrom={year}-01-01&validTo={year}-12-31";
        var fetched = new List<(HolidayKind Kind, OpenHoliday Holiday)>();
        foreach (var (kind, path) in new[] { (HolidayKind.Schulferien, "SchoolHolidays"), (HolidayKind.Feiertag, "PublicHolidays") })
        {
            var holidays = await client.GetFromJsonAsync<List<OpenHoliday>>(path + query) ?? [];
            fetched.AddRange(holidays.Select(holiday => (kind, holiday)));
        }

        var (from, to) = YearRange(year);
        var existing = await db.SchoolHolidays
            .Where(h => h.StartDate <= to && h.EndDate >= from)
            .ToListAsync();

        var imported = 0;
        foreach (var (kind, holiday) in fetched)
        {
            if (existing.Any(h => h.Kind == kind && h.StartDate == holiday.StartDate && h.EndDate == holiday.EndDate))
                continue;

            db.SchoolHolidays.Add(new SchoolHoliday
            {
                Name = holiday.Name?.FirstOrDefault()?.Text ?? kind.ToString(),
                Kind = kind,
                StartDate = holiday.StartDate,
                EndDate = holiday.EndDate,
            });
            imported++;
        }

        await db.SaveChangesAsync();
        return new ImportResult(imported, fetched.Count);
    }
}
