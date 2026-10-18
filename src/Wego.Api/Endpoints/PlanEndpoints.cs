using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

public static class PlanEndpoints
{
    public const int MaxEntriesPerDay = 10;

    public record PlanEmployeeDto(int Id, string Name, Activity? MainActivity, IReadOnlyList<Activity> AdditionalActivities);
    public record SchoolHolidayDto(int Id, string Name, HolidayKind Kind, DateOnly StartDate, DateOnly EndDate);
    public record EntryDto(int Id, int EmployeeId, string EmployeeName, DateOnly Date, EntryType Type,
        int? SiteId, string? SiteName, Activity? Activity, TimeOnly? StartTime, TimeOnly? EndTime,
        string? Note);
    public record PlanDto(int Year, IReadOnlyList<PlanEmployeeDto> Employees, IReadOnlyList<EntryDto> Entries,
        IReadOnlyList<SchoolHolidayDto> SchoolHolidays, IReadOnlyList<SiteEndpoints.SiteDto> Sites);

    /// <summary>A site entry names its construction site by <paramref name="SiteId"/>.</summary>
    public record DayEntryInput(EntryType Type, int? SiteId, TimeOnly? StartTime, TimeOnly? EndTime,
        string? Note, Activity? Activity = null);
    public record DayInput(int EmployeeId, DateOnly Date, DayEntryInput[] Entries);

    public const int MaxDaysPerBatch = 400;

    public static void MapPlanEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/plan", async (int year, WegoDbContext db) =>
        {
            var (from, to) = YearRange(year);

            var entries = await EntriesQuery(db)
                .Where(e => e.Date >= from && e.Date <= to)
                .ToListAsync();

            // Former employees stay visible in the years they still have entries in.
            var withEntries = entries.Select(e => e.EmployeeId).ToHashSet();
            var employees = (await db.Employees
                    .Where(e => e.ShowInPlan)
                    .OrderBy(e => e.SortOrder).ThenBy(e => e.Name)
                    .ToListAsync())
                .Where(e => e.IsActive || withEntries.Contains(e.Id))
                .Select(e => new PlanEmployeeDto(e.Id, e.Name, e.MainActivity, e.AdditionalActivities))
                .ToList();

            var holidays = await db.SchoolHolidays
                .Where(h => h.StartDate <= to && h.EndDate >= from)
                .OrderBy(h => h.StartDate)
                .Select(h => new SchoolHolidayDto(h.Id, h.Name, h.Kind, h.StartDate, h.EndDate))
                .ToListAsync();

            var sites = (await db.Sites.AsNoTracking().OrderBy(s => s.Name).ToListAsync())
                .Select(SiteEndpoints.ToDto)
                .ToList();

            return new PlanDto(year, employees, Sort(entries.Select(ToDto)), holidays, sites);
        });

        // Replaces all entries of one employee on one day, so a split day is always saved as a whole.
        app.MapPut("/api/plan/{employeeId:int}/{date}", async (int employeeId, DateOnly date,
            DayEntryInput[] inputs, WegoDbContext db) =>
        {
            if (!await db.Employees.AnyAsync(e => e.Id == employeeId)) return Results.NotFound();
            return await SaveDays(db, [new DayInput(employeeId, date, inputs)]);
        }).RequireAuthorization(Roles.Planer);

        // Several days at once (a selection in the plan, pasting, copying a week, undo), all or nothing.
        app.MapPut("/api/plan/batch", async (DayInput[] days, WegoDbContext db) =>
        {
            if (days.Length > MaxDaysPerBatch)
                return ApiErrors.BadRequest($"Es können höchstens {MaxDaysPerBatch} Tage auf einmal gespeichert werden.");
            if (days.GroupBy(d => (d.EmployeeId, d.Date)).Any(g => g.Count() > 1))
                return ApiErrors.BadRequest("Jeder Tag eines Mitarbeiters darf nur einmal vorkommen.");

            var employeeIds = days.Select(d => d.EmployeeId).Distinct().ToList();
            if (await db.Employees.CountAsync(e => employeeIds.Contains(e.Id)) != employeeIds.Count)
                return Results.NotFound();

            return await SaveDays(db, days);
        }).RequireAuthorization(Roles.Planer);
    }

    /// <summary>Replaces the entries of the given days in one transaction and returns what is stored now.</summary>
    private static async Task<IResult> SaveDays(WegoDbContext db, IReadOnlyList<DayInput> days)
    {
        foreach (var day in days)
        {
            var error = Validate(day.Entries ?? []);
            if (error is not null) return ApiErrors.BadRequest($"{day.Date:dd.MM.yyyy}: {error}");
        }

        var siteIds = days.SelectMany(d => d.Entries ?? []).Where(e => e.SiteId is not null)
            .Select(e => e.SiteId!.Value).Distinct().ToList();
        if (await db.Sites.CountAsync(s => siteIds.Contains(s.Id)) != siteIds.Count)
            return ApiErrors.BadRequest("Eine der Baustellen gibt es nicht (mehr).");

        await using var transaction = await db.Database.BeginTransactionAsync();

        foreach (var day in days)
        {
            var existing = await db.PlanEntries
                .Where(e => e.EmployeeId == day.EmployeeId && e.Date == day.Date)
                .ToListAsync();
            db.PlanEntries.RemoveRange(existing);

            foreach (var input in day.Entries ?? [])
            {

                db.PlanEntries.Add(new PlanEntry
                {
                    EmployeeId = day.EmployeeId,
                    Date = day.Date,
                    Type = input.Type,
                    SiteId = input.Type == EntryType.Baustelle ? input.SiteId : null,
                    // The activity belongs to work on a site; vacation and sick days have none.
                    Activity = input.Type == EntryType.Baustelle ? input.Activity : null,
                    StartTime = input.StartTime,
                    EndTime = input.EndTime,
                    Note = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim(),
                });
            }
        }

        await db.SaveChangesAsync();
        await transaction.CommitAsync();

        var employeeIds = days.Select(d => d.EmployeeId).Distinct().ToList();
        var dates = days.Select(d => d.Date).Distinct().ToList();
        var keys = days.Select(d => (d.EmployeeId, d.Date)).ToHashSet();
        var saved = (await EntriesQuery(db)
                .Where(e => employeeIds.Contains(e.EmployeeId) && dates.Contains(e.Date))
                .ToListAsync())
            .Where(e => keys.Contains((e.EmployeeId, e.Date)));
        return Results.Ok(Sort(saved.Select(ToDto)));
    }


    public static (DateOnly From, DateOnly To) YearRange(int year) =>
        (new DateOnly(year, 1, 1), new DateOnly(year, 12, 31));

    public static IQueryable<PlanEntry> EntriesQuery(WegoDbContext db) =>
        db.PlanEntries.AsNoTracking().Include(e => e.Site).Include(e => e.Employee);

    public static EntryDto ToDto(PlanEntry e) => new(e.Id, e.EmployeeId, e.Employee.Name, e.Date, e.Type,
        e.SiteId, e.Site?.Name, e.Activity, e.StartTime, e.EndTime, e.Note);

    public static List<EntryDto> Sort(IEnumerable<EntryDto> entries) => entries
        .OrderBy(e => e.Date)
        .ThenBy(e => e.StartTime ?? TimeOnly.MaxValue)
        .ThenBy(e => e.Id)
        .ToList();

    private static string? Validate(DayEntryInput[] inputs)
    {
        if (inputs.Length > MaxEntriesPerDay)
            return $"Pro Tag sind höchstens {MaxEntriesPerDay} Einträge möglich.";

        foreach (var input in inputs)
        {
            if (!Enum.IsDefined(input.Type)) return "Unbekannte Art des Eintrags.";
            if (input.Activity is { } activity && !Enum.IsDefined(activity)) return "Unbekannte Tätigkeit.";

            if (input.Type == EntryType.Baustelle && input.SiteId is null)
                return "Bitte für jeden Einsatz eine Baustelle wählen.";

            if ((input.StartTime is null) != (input.EndTime is null))
                return "Bitte Beginn und Ende des Zeitfensters angeben oder beide leer lassen.";
            if (input.StartTime >= input.EndTime)
                return "Das Ende eines Zeitfensters muss nach dem Beginn liegen.";
            if (input.Note?.Length > 500) return "Die Notiz darf höchstens 500 Zeichen lang sein.";
        }

        var timed = inputs.Where(i => i.StartTime is not null).OrderBy(i => i.StartTime).ToList();
        for (var i = 1; i < timed.Count; i++)
        {
            if (timed[i].StartTime < timed[i - 1].EndTime)
                return "Die Zeitfenster eines Tages dürfen sich nicht überschneiden.";
        }

        return null;
    }
}
