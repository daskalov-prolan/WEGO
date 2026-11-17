using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>
/// Planning the visits (Besichtigungen) of the enquiries, by those who go out to them (Stefan, Tsonyo) or a planner
/// for them: customer by customer, all or those of a region, on any day; they set their tours themselves. A day of
/// visits is set aside by the planners in the calendar of the offer phase: an entry with the activity Besichtigung
/// and no site over the day; each customer is an hour on site, an entry of the step Besichtigung of the enquiry.
/// </summary>
public static class VisitEndpoints
{
    public const string Activity = "Besichtigung";

    /// <summary>The regions of the planners: their enquiries are listed (and shown on the map) together.</summary>
    public static readonly string[] Regions = ["Karow", "Reinickendorf"];

    /// <summary>The branches of WEGO, as stars on the map of the visits.</summary>
    public static readonly PlaceDto[] Branches =
    [
        new("WEGO Karow", "Alt-Karow 53, 13125 Berlin", 52.6114701, 13.4824105),
        new("WEGO Waidmannslust", "Oraniendamm 14, 13469 Berlin", 52.6085806, 13.3229231),
    ];

    /// <summary>A day set aside for visits: the working day.</summary>
    public static readonly TimeOnly DayFrom = new(7, 30), DayTo = new(16, 0);

    /// <summary>An hour on site.</summary>
    public static readonly TimeSpan OnSite = TimeSpan.FromHours(1);

    public record PlaceDto(string Name, string Address, double Latitude, double Longitude);

    public record VisitorDto(int Id, string Name);

    /// <summary>A customer agreed; <paramref name="Region"/> that of the planner of the enquiry.</summary>
    public record VisitDto(int EntryId, int SiteId, string Name, string? Address, string? Phone, double? Latitude, double? Longitude,
        TimeOnly From, TimeOnly To, string? Region = null);

    /// <summary>
    /// A day with visits of one who goes out: set aside for them by the planners (<paramref name="Reserved"/>), or
    /// with a customer planned on its own; with the customers planned on it so far.
    /// </summary>
    public record DayDto(DateOnly Date, IReadOnlyList<VisitDto> Visits, bool Reserved = true, int EmployeeId = 0, string Employee = "");

    /// <summary>An enquiry without a visit yet; <paramref name="Region"/> that of its planner.</summary>
    public record EnquiryDto(int SiteId, string Name, string? Address, string? Phone, IReadOnlyList<string> Scope,
        string? Description, DateOnly? RequestedOn, string? Planner, string? Region, double? Latitude, double? Longitude,
        OfferEndpoints.CallDto? Call, OfferEndpoints.DeclineReportDto? Report = null);

    /// <summary>Something else in the plan of the visitor (without times the whole day): to warn of an overlap.</summary>
    public record BusyDto(DateOnly Date, string Name, TimeOnly? From, TimeOnly? To);

    /// <summary>
    /// <paramref name="Visitors"/>: whom a planner may plan for (empty for a craftsman, who plans his own).
    /// <paramref name="Days"/>: the days of visits of all who go out, from today on.
    /// <paramref name="Busy"/>: the rest of the plan of the one chosen (<paramref name="EmployeeId"/>).
    /// <paramref name="Pending"/>: enquiries whose address is not on the map yet (looked up a few at a time).
    /// </summary>
    public record VisitPlanDto(int EmployeeId, IReadOnlyList<PlaceDto> Branches, IReadOnlyList<VisitorDto> Visitors, IReadOnlyList<string> Regions,
        IReadOnlyList<DayDto> Days, IReadOnlyList<EnquiryDto> Enquiries, IReadOnlyList<BusyDto> Busy, int Pending,
        IReadOnlyList<string> DeclineReasons);

    public record DayInput(int EmployeeId, DateOnly Date);
    public record VisitInput(int EmployeeId, int SiteId, DateOnly Date, TimeOnly Start);
    public record CallInput(int EmployeeId, int SiteId);
    public record DeclineInput(int EmployeeId, int SiteId, string Reason, string? Note);

    /// <summary>How far ahead the days of visits and the plan are looked at.</summary>
    private const int DaysAhead = 90;

    public static void MapVisitEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/visits").RequireAuthorization();

        group.MapGet("/", async (int? employeeId, ClaimsPrincipal user, WegoDbContext db, IGeocoder geocoder) =>
        {
            var visitors = await VisitorsAsync(db);
            // Whoever goes out plans his own; a planner the first who goes out (or another chosen).
            var id = employeeId ?? (visitors.Any(v => v.Id == user.EmployeeId()) && !user.CanPlan() ? user.EmployeeId() : visitors.FirstOrDefault()?.Id ?? 0);
            if (Denied(user, id, visitors) is { } denied) return denied;
            return Results.Ok(await LoadAsync(db, geocoder, id, user.CanPlan() ? visitors : []));
        });

        // A day set aside for visits, by the planners: the whole day.
        group.MapPost("/days", async (DayInput input, ClaimsPrincipal user, WegoDbContext db, IGeocoder geocoder) =>
        {
            if (!user.CanPlan()) return Results.Forbid();
            var visitors = await VisitorsAsync(db);
            if (Denied(user, input.EmployeeId, visitors) is { } denied) return denied;
            if (input.Date < Today) return ApiErrors.BadRequest("Ein Besichtigungstag liegt heute oder später.");
            if (await SetDayAsync(db, input.EmployeeId, input.Date) is { } error) return ApiErrors.BadRequest(error);
            ChangeLog.Add(db, user, ChangeArea.Plan, "Besichtigungstag", input.EmployeeId, null, new { input.Date }, input.Date);
            await db.SaveChangesAsync();
            return Results.Ok(await LoadAsync(db, geocoder, input.EmployeeId, visitors));
        });

        // A day of visits not needed, released by the planner or by who visits: free for other work again.
        group.MapPost("/days/remove", async (DayInput input, ClaimsPrincipal user, WegoDbContext db, IGeocoder geocoder) =>
        {
            var visitors = await VisitorsAsync(db);
            if (Denied(user, input.EmployeeId, visitors) is { } denied) return denied;
            var entries = await db.PlanEntries.Where(e => e.EmployeeId == input.EmployeeId && e.Date == input.Date && e.Activity == Activity)
                .ToListAsync();
            if (entries.All(e => e.SiteId is not null)) return ApiErrors.BadRequest("An dem Tag ist kein Besichtigungstag reserviert.");
            if (entries.Any(e => e.SiteId is not null))
                return ApiErrors.BadRequest("An dem Tag sind schon Besichtigungen geplant: erst diese verschieben.");
            db.PlanEntries.RemoveRange(entries);
            ChangeLog.Add(db, user, ChangeArea.Plan, "Besichtigungstag freigegeben", input.EmployeeId, new { input.Date }, null, input.Date);
            await db.SaveChangesAsync();
            return Results.Ok(await LoadAsync(db, geocoder, input.EmployeeId, user.CanPlan() ? visitors : []));
        });

        // One customer, on any day from today on, an hour from the start (a visit planned before moves there).
        group.MapPost("/", async (VisitInput input, ClaimsPrincipal user, WegoDbContext db, IGeocoder geocoder) =>
        {
            var visitors = await VisitorsAsync(db);
            if (Denied(user, input.EmployeeId, visitors) is { } denied) return denied;
            if (input.Date < Today) return ApiErrors.BadRequest("Eine Besichtigung liegt heute oder später.");
            await using var transaction = await db.Database.BeginTransactionAsync();
            var step = new OfferEndpoints.StepInput(Activity, [input.EmployeeId], input.Date, input.Start, input.Start.Add(OnSite));
            if (await OfferEndpoints.SaveStepAsync(db, user, input.SiteId, step) is { } error) return ApiErrors.BadRequest(error);
            await transaction.CommitAsync();
            return Results.Ok(await LoadAsync(db, geocoder, input.EmployeeId, user.CanPlan() ? visitors : []));
        });

        // The customer says no on the telephone: declined with the reason of the visit, as in the offer phase.
        group.MapPost("/decline", async (DeclineInput input, ClaimsPrincipal user, WegoDbContext db, IGeocoder geocoder) =>
        {
            var visitors = await VisitorsAsync(db);
            if (Denied(user, input.EmployeeId, visitors) is { } denied) return denied;
            var site = await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == input.SiteId);
            if (site is null) return ApiErrors.BadRequest("Die Anfrage gibt es nicht (mehr).");
            // A planner declines at once; who visits reports it, for a planner to confirm.
            var error = user.CanPlan()
                ? await OfferEndpoints.DeclineAsync(db, user, site, input.Reason, input.Note)
                : await OfferEndpoints.ReportDeclineAsync(db, user, site, input.Reason, input.Note);
            if (error is not null) return ApiErrors.BadRequest(error);
            return Results.Ok(await LoadAsync(db, geocoder, input.EmployeeId, user.CanPlan() ? visitors : []));
        });

        // The customer called and not reached: kept with the time and the caller, shown on the card of the enquiry.
        group.MapPost("/not-reached", async (CallInput input, ClaimsPrincipal user, WegoDbContext db, IGeocoder geocoder) =>
        {
            var visitors = await VisitorsAsync(db);
            if (Denied(user, input.EmployeeId, visitors) is { } denied) return denied;
            var site = await db.Sites.FindAsync(input.SiteId);
            if (site is null || !OfferEndpoints.IsOffer(site)) return ApiErrors.BadRequest("Die Anfrage gibt es nicht (mehr).");
            db.CallAttempts.Add(new CallAttempt { SiteId = input.SiteId, EmployeeId = user.EmployeeId(), At = DateTime.UtcNow });
            await db.SaveChangesAsync();
            return Results.Ok(await LoadAsync(db, geocoder, input.EmployeeId, user.CanPlan() ? visitors : []));
        });
    }

    private static DateOnly Today => DateOnly.FromDateTime(DateTime.Today);

    /// <summary>Whoever does visits: the craftsmen given the activity first, then the planners.</summary>
    private static async Task<List<VisitorDto>> VisitorsAsync(WegoDbContext db) =>
        (await db.Employees.Where(e => e.IsActive && e.DeletedAt == null).OrderBy(e => e.SortOrder).ThenBy(e => e.Name).ToListAsync())
        .Where(e => e.AdditionalActivities.Contains(Activity) || e.MainActivity == Activity || Roles.CanPlan(e.Role))
        .OrderBy(e => Roles.CanPlan(e.Role))
        .Select(e => new VisitorDto(e.Id, e.Name)).ToList();

    /// <summary>Planners for every visitor; a craftsman doing visits for himself only.</summary>
    private static IResult? Denied(ClaimsPrincipal user, int employeeId, IReadOnlyList<VisitorDto> visitors)
    {
        if (!visitors.Any(v => v.Id == employeeId)) return user.CanPlan() ? ApiErrors.BadRequest("Dieser Mitarbeiter macht keine Besichtigungen.") : Results.Forbid();
        return user.CanPlan() || user.EmployeeId() == employeeId ? null : Results.Forbid();
    }

    /// <summary>Sets the day aside; time kept free gives way, other work on the day is said.</summary>
    private static async Task<string?> SetDayAsync(WegoDbContext db, int employeeId, DateOnly date)
    {
        var entries = await db.PlanEntries.Include(e => e.Site).Where(e => e.EmployeeId == employeeId && e.Date == date).ToListAsync();
        if (entries.Any(e => e.Activity == Activity && e.SiteId is null)) return $"{date:dd.MM.yyyy} ist schon ein Besichtigungstag.";
        foreach (var other in entries.Where(e => !(e.Activity == Activity && e.SiteId is not null)))
        {
            if (OfferEndpoints.IsFree(other)) db.PlanEntries.Remove(other);
            else if (other.Type != EntryType.Baustelle) return $"{date:dd.MM.yyyy}: an dem Tag ist {other.Type}.";
            else return $"{date:dd.MM.yyyy}: an dem Tag ist schon {other.Site?.Name ?? "ein Eintrag"} eingeplant.";
        }
        db.PlanEntries.Add(new PlanEntry
        {
            EmployeeId = employeeId, Date = date, Type = EntryType.Baustelle, Activity = Activity, StartTime = DayFrom, EndTime = DayTo,
        });
        return null;
    }

    /// <summary>The customer as on the cards: with Herr, Frau or Familie.</summary>
    private static string Customer(Site s) => string.IsNullOrWhiteSpace(s.Salutation) ? s.Name : $"{s.Salutation} {s.Name}";

    private static string? Address(Site s)
    {
        var street = string.Join(' ', new[] { s.Street, s.HouseNumber }.Where(x => !string.IsNullOrWhiteSpace(x)));
        var place = string.Join(' ', new[] { s.PostalCode, s.City }.Where(x => !string.IsNullOrWhiteSpace(x)));
        var all = string.Join(", ", new[] { street, place }.Where(x => x.Length > 0));
        return all.Length == 0 ? null : all;
    }

    private static async Task<VisitPlanDto> LoadAsync(WegoDbContext db, IGeocoder geocoder, int employeeId, IReadOnlyList<VisitorDto> visitors)
    {
        var today = Today;
        var until = today.AddDays(DaysAhead);
        var entries = await db.PlanEntries.Include(e => e.Site)
            .Where(e => e.EmployeeId == employeeId && e.Date >= today && e.Date <= until)
            .OrderBy(e => e.Date).ThenBy(e => e.StartTime).ToListAsync();
        // The days of visits of everybody who goes out.
        var visitEntries = await db.PlanEntries.Include(e => e.Site).ThenInclude(s => s!.ResponsiblePlanner).Include(e => e.Employee)
            .Where(e => e.Activity == Activity && e.Date >= today && e.Date <= until)
            .OrderBy(e => e.Date).ThenBy(e => e.StartTime).ToListAsync();

        // The enquiries without a visit yet; their addresses looked up on the map, a few at a time.
        var offers = (await db.Sites.Include(s => s.ResponsiblePlanner).Where(s => s.Status == SiteStatus.Angebot).ToListAsync())
            .Where(OfferEndpoints.IsOffer).ToList();
        var visited = (await db.PlanEntries.Where(e => e.Activity == Activity && e.SiteId != null).Select(e => e.SiteId!.Value).Distinct().ToListAsync())
            .ToHashSet();
        var open = offers.Where(s => !visited.Contains(s.Id)).ToList();
        var lookUps = open.Concat(visitEntries.Where(e => e.Site is not null).Select(e => e.Site!)).Where(LocationEndpoints.NeedsLookUp)
            .Distinct().Take(LocationEndpoints.LookUpsPerRequest).ToList();
        foreach (var site in lookUps)
            if (!await LocationEndpoints.LookUpAsync(site, geocoder)) break;
        if (lookUps.Count > 0) await db.SaveChangesAsync();

        VisitDto Visit(PlanEntry v) => new(v.Id, v.Site!.Id, Customer(v.Site), Address(v.Site), v.Site.ClientPhone,
            v.Site.Latitude, v.Site.Longitude, v.StartTime ?? DayFrom, v.EndTime ?? (v.StartTime ?? DayFrom).Add(OnSite),
            v.Site.ResponsiblePlanner?.Region);
        var days = visitEntries.GroupBy(e => (e.Date, e.EmployeeId))
            .Select(day => new DayDto(day.Key.Date, day.Where(e => e.Site is not null).Select(Visit).ToList(),
                day.Any(e => e.SiteId is null), day.Key.EmployeeId, day.First().Employee?.Name ?? ""))
            .OrderBy(d => d.Date).ThenBy(d => d.Employee)
            .ToList();

        // The rest of the plan, to warn of an overlap: time kept free and the day of visits itself hold nothing.
        var labels = await db.Activities.ToDictionaryAsync(a => a.Key, a => a.Label);
        var busy = entries
            .Where(e => !OfferEndpoints.IsFree(e) && !(e.Activity == Activity && e.SiteId is null))
            .Select(e => new BusyDto(e.Date,
                e.Site is { } site ? (e.Activity == Activity ? $"Besichtigung {Customer(site)}" : site.Name)
                    : e.Type != EntryType.Baustelle ? e.Type.ToString()
                    : e.Activity is { } a && labels.TryGetValue(a, out var label) ? label : "Eintrag",
                e.StartTime, e.EndTime))
            .ToList();

        var calls = (await OfferEndpoints.CallsAsync(db, open.Select(s => s.Id).ToList())).ToDictionary(c => c.SiteId);
        var enquiries = open.OrderBy(s => s.RequestedOn ?? DateOnly.MaxValue).ThenBy(s => s.Id)
            .Select(s => new EnquiryDto(s.Id, Customer(s), Address(s), s.ClientPhone, s.Scope, s.Description, s.RequestedOn,
                s.ResponsiblePlanner?.Name, s.ResponsiblePlanner?.Region, s.Latitude, s.Longitude, calls.GetValueOrDefault(s.Id),
                OfferEndpoints.ReportOf(s)))
            .ToList();
        return new VisitPlanDto(employeeId, Branches, visitors, Regions, days, enquiries, busy, open.Count(LocationEndpoints.NeedsLookUp),
            OfferEndpoints.ReasonsAt(Activity));
    }
}
