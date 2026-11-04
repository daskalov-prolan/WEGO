using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

public static class PlanEndpoints
{
    public const int MaxEntriesPerDay = 10;

    /// <summary>
    /// <paramref name="IsPlaner"/>: Planer A or G, who do all activities of the offer phase.
    /// <paramref name="IsCraftsman"/>: has a row in the plan and does all activities of the construction phase.
    /// Somebody can be both.
    /// </summary>
    public record PlanEmployeeDto(int Id, string Name, string? MainActivity, IReadOnlyList<string> AdditionalActivities,
        bool IsPlaner, bool IsCraftsman);
    public record SchoolHolidayDto(int Id, string Name, HolidayKind Kind, DateOnly StartDate, DateOnly EndDate);
    public record EntryDto(int Id, int EmployeeId, string EmployeeName, DateOnly Date, EntryType Type,
        int? SiteId, string? SiteName, string? Activity, TimeOnly? StartTime, TimeOnly? EndTime,
        string? Note, bool NoteImportant);
    /// <summary>
    /// <paramref name="Planners"/>: the active planners not shown in the plan otherwise, for the offer phase.
    /// <paramref name="OfferPhase"/>: whether the viewer may see the offer phase (see <see cref="OfferAccess"/>);
    /// without it the plan holds no offer sites and no offer work of others.
    /// </summary>
    public record PlanDto(int Year, IReadOnlyList<PlanEmployeeDto> Employees, IReadOnlyList<EntryDto> Entries,
        IReadOnlyList<SchoolHolidayDto> SchoolHolidays, IReadOnlyList<SiteEndpoints.SiteDto> Sites,
        IReadOnlyList<PlanEmployeeDto> Planners, bool OfferPhase);

    /// <summary>A site entry names its construction site by <paramref name="SiteId"/>.</summary>
    public record DayEntryInput(EntryType Type, int? SiteId, TimeOnly? StartTime, TimeOnly? EndTime,
        string? Note, string? Activity = null, bool NoteImportant = false);
    public record DayInput(int EmployeeId, DateOnly Date, DayEntryInput[] Entries);

    /// <summary>An entry as it is written into the change log, with the site name for readability.</summary>
    private record LoggedEntry(EntryType Type, int? SiteId, string? SiteName, string? Activity,
        TimeOnly? StartTime, TimeOnly? EndTime, string? Note, bool NoteImportant);

    public const int MaxDaysPerBatch = 400;

    public static void MapPlanEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/plan", async (int year, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var (from, to) = YearRange(year);
            var access = await OfferAccess.ForAsync(user, db);
            var allSites = await db.Sites.AsNoTracking().Include(s => s.Tasks).OrderBy(s => s.Name).ToListAsync();
            var siteStatus = allSites.ToDictionary(s => s.Id, s => s.Status);

            var entries = (await EntriesQuery(db)
                    .Where(e => e.Date >= from && e.Date <= to)
                    .ToListAsync())
                .Where(e => access.Shows(e, siteStatus))
                .ToList();

            // Former employees stay visible in the years they still have entries in.
            var withEntries = entries.Select(e => e.EmployeeId).ToHashSet();
            var all = await db.Employees.OrderBy(e => e.SortOrder).ThenBy(e => e.Name).ToListAsync();
            var employees = all
                .Where(e => e.ShowInPlan && (e.IsActive || withEntries.Contains(e.Id)))
                .Select(ToPlanEmployee)
                .ToList();
            // Planners do the visits and offers even when the plan does not show them as a column.
            var planners = all
                .Where(e => access.SeesOffers && !e.ShowInPlan && Roles.CanPlan(e.Role) && (e.IsActive || withEntries.Contains(e.Id)))
                .Select(ToPlanEmployee)
                .ToList();

            var holidays = await db.SchoolHolidays
                .Where(h => h.StartDate <= to && h.EndDate >= from)
                .OrderBy(h => h.StartDate)
                .Select(h => new SchoolHolidayDto(h.Id, h.Name, h.Kind, h.StartDate, h.EndDate))
                .ToListAsync();

            var sites = allSites.Where(access.Shows).Select(SiteEndpoints.ToDto).ToList();

            return new PlanDto(year, employees, Sort(entries.Select(ToDto)), holidays, sites, planners, access.SeesOffers);
        });

        // Replaces all entries of one employee on one day, so a split day is always saved as a whole.
        app.MapPut("/api/plan/{employeeId:int}/{date}", async (int employeeId, DateOnly date,
            DayEntryInput[] inputs, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (!await db.Employees.AnyAsync(e => e.Id == employeeId)) return Results.NotFound();
            return await SaveDays(db, user, [new DayInput(employeeId, date, inputs)]);
        }).RequireAuthorization(Policies.Plan);

        // Several days at once (a selection in the plan, pasting, copying a week, undo), all or nothing.
        app.MapPut("/api/plan/batch", async (DayInput[] days, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (days.Length > MaxDaysPerBatch)
                return ApiErrors.BadRequest($"Es können höchstens {MaxDaysPerBatch} Tage auf einmal gespeichert werden.");
            if (days.GroupBy(d => (d.EmployeeId, d.Date)).Any(g => g.Count() > 1))
                return ApiErrors.BadRequest("Jeder Tag eines Mitarbeiters darf nur einmal vorkommen.");

            var employeeIds = days.Select(d => d.EmployeeId).Distinct().ToList();
            if (await db.Employees.CountAsync(e => employeeIds.Contains(e.Id)) != employeeIds.Count)
                return Results.NotFound();

            return await SaveDays(db, user, days);
        }).RequireAuthorization(Policies.Plan);
    }

    /// <summary>
    /// Replaces the entries of the given days in one transaction, logs every day that changed,
    /// and returns what is stored now.
    /// </summary>
    private static async Task<IResult> SaveDays(WegoDbContext db, ClaimsPrincipal user, IReadOnlyList<DayInput> days)
    {
        var activities = (await db.Activities.Select(a => a.Key).ToListAsync()).ToHashSet();
        foreach (var day in days)
        {
            var error = Validate(day.Entries ?? [], activities);
            if (error is not null) return ApiErrors.BadRequest($"{day.Date:dd.MM.yyyy}: {error}");
        }

        var siteIds = days.SelectMany(d => d.Entries ?? []).Where(e => e.SiteId is not null)
            .Select(e => e.SiteId!.Value).Distinct().ToList();
        var siteNames = await db.Sites.Where(s => siteIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name);
        if (siteNames.Count != siteIds.Count)
            return ApiErrors.BadRequest("Eine der Baustellen gibt es nicht (mehr).");

        await using var transaction = await db.Database.BeginTransactionAsync();

        foreach (var day in days)
        {
            var existing = await db.PlanEntries
                .Include(e => e.Site)
                .Where(e => e.EmployeeId == day.EmployeeId && e.Date == day.Date)
                .OrderBy(e => e.Id)
                .ToListAsync();
            db.PlanEntries.RemoveRange(existing);
            var before = existing.Select(e => new LoggedEntry(e.Type, e.SiteId, e.Site?.Name, e.Activity,
                e.StartTime, e.EndTime, e.Note, e.NoteImportant)).ToList();
            var after = new List<LoggedEntry>();

            foreach (var input in day.Entries ?? [])
            {
                var entry = new PlanEntry
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
                    // Only a note can be important.
                    NoteImportant = input.NoteImportant && !string.IsNullOrWhiteSpace(input.Note),
                };
                db.PlanEntries.Add(entry);
                after.Add(new LoggedEntry(entry.Type, entry.SiteId,
                    entry.SiteId is { } siteId ? siteNames[siteId] : null, entry.Activity,
                    entry.StartTime, entry.EndTime, entry.Note, entry.NoteImportant));
            }

            // Urlaub and Krank are entered, changed and removed by Planer G only (everybody sees them).
            if (!user.IsPlanerG() && ChangeLog.ToJson(Absences(before)) != ChangeLog.ToJson(Absences(after)))
                return ApiErrors.BadRequest($"{day.Date:dd.MM.yyyy}: Urlaub und Krank trägt nur Planer G ein.");

            // Saving a day unchanged (e.g. a selection that covers it) is no change worth logging.
            if (ChangeLog.ToJson(before) == ChangeLog.ToJson(after)) continue;
            var action = before.Count == 0 ? "Eingetragen" : after.Count == 0 ? "Gelöscht" : "Geändert";
            ChangeLog.Add(db, user, ChangeArea.Plan, action, day.EmployeeId,
                before.Count == 0 ? null : before, after.Count == 0 ? null : after, day.Date);
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


    private static List<LoggedEntry> Absences(IEnumerable<LoggedEntry> entries) =>
        entries.Where(e => e.Type != EntryType.Baustelle).ToList();

    public static (DateOnly From, DateOnly To) YearRange(int year) =>
        (new DateOnly(year, 1, 1), new DateOnly(year, 12, 31));

    public static IQueryable<PlanEntry> EntriesQuery(WegoDbContext db) =>
        db.PlanEntries.AsNoTracking().Include(e => e.Site).Include(e => e.Employee);

    private static PlanEmployeeDto ToPlanEmployee(Employee e) =>
        new(e.Id, e.Name, e.MainActivity, e.AdditionalActivities, Roles.CanPlan(e.Role), e.ShowInPlan);

    public static EntryDto ToDto(PlanEntry e) => new(e.Id, e.EmployeeId, e.Employee.Name, e.Date, e.Type,
        e.SiteId, e.Site?.Name, e.Activity, e.StartTime, e.EndTime, e.Note, e.NoteImportant);

    public static List<EntryDto> Sort(IEnumerable<EntryDto> entries) => entries
        .OrderBy(e => e.Date)
        .ThenBy(e => e.StartTime ?? TimeOnly.MaxValue)
        .ThenBy(e => e.Id)
        .ToList();

    private static string? Validate(DayEntryInput[] inputs, IReadOnlySet<string> activities)
    {
        if (inputs.Length > MaxEntriesPerDay)
            return $"Pro Tag sind höchstens {MaxEntriesPerDay} Einträge möglich.";

        foreach (var input in inputs)
        {
            if (!Enum.IsDefined(input.Type)) return "Unbekannte Art des Eintrags.";
            if (input.Activity is { } activity && !activities.Contains(activity)) return "Unbekannte Tätigkeit.";

            // A Besichtigung can be planned before it is known where: then the activity says what it is.
            if (input.Type == EntryType.Baustelle && input.SiteId is null && input.Activity is null)
                return "Bitte für jeden Einsatz eine Baustelle oder eine Tätigkeit wählen.";

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
