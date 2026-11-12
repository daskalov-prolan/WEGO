using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>
/// The offer phase as an overview: the enquiries (sites in the offer) with their steps in a fixed order, each step
/// once; the customer says yes (into the construction phase, with its start) or no (declined, with a reason).
/// </summary>
public static class OfferEndpoints
{
    /// <summary>What a customer may want done (Umfang).</summary>
    public static readonly string[] Scopes =
    [
        "Komplettsanierung Bad", "Gäste-WC", "Duschumbau", "Wanne zu Dusche", "Nur Fliesen", "Nur Sanitär",
        "Sanierung Wohnung / Haus", "Sonstiges",
    ];

    /// <summary>Why a customer said no; "Sonstiges" needs a few words.</summary>
    public static readonly string[] DeclineReasons =
    [
        "Preis zu hoch", "Anderer Anbieter beauftragt", "Baubeginn zu spät / Termin passt nicht",
        "Vorhaben verschoben", "Finanzierung oder Förderung nicht geklärt",
        "Keine Rückmeldung mehr", "Sonstiges",
    ];

    public const string Other = "Sonstiges";

    /// <summary>Steps that may need more than one appointment (a second or third Objektauswahl).</summary>
    public static readonly string[] Repeatable = ["Objektauswahl"];

    /// <summary>One appointment of a step: an entry in the plan of an employee.</summary>
    public record StepDto(int SiteId, string Activity, int EntryId, int EmployeeId, string EmployeeName, DateOnly Date,
        TimeOnly? StartTime, TimeOnly? EndTime);

    /// <summary>A site decided lately: into the construction phase, or declined.</summary>
    public record DecidedDto(int SiteId, string Name, SiteStatus Status, DateTime DecidedAt, DateOnly? PlannedStart,
        string? DeclineReason, string? DeclineNote);

    /// <summary>
    /// <paramref name="StepActivities"/>: the steps after the enquiry, in their order (the offer activities but
    /// Anfrage, by the order kept under Verwaltung).
    /// </summary>
    public record OffersDto(IReadOnlyList<SiteEndpoints.SiteDto> Sites, IReadOnlyList<StepDto> Steps,
        IReadOnlyList<string> StepActivities, IReadOnlyList<DecidedDto> Decided);

    /// <summary>
    /// <paramref name="Another"/>: one more appointment of a step that may have several (see <see cref="Repeatable"/>);
    /// <paramref name="From"/>: the day of the appointment moved, when the step has several; else all of it moves.
    /// </summary>
    public record StepInput(string Activity, int[] EmployeeIds, DateOnly Date, TimeOnly StartTime, TimeOnly EndTime,
        bool Another = false, DateOnly? From = null);
    public record AcceptInput(DateOnly PlannedStart);
    public record DeclineInput(string Reason, string? Note);

    /// <summary>How far back decided sites are listed below the overview.</summary>
    private const int DecidedDays = 60;

    public static void MapOfferEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/offers").RequireAuthorization(Policies.Plan);

        group.MapGet("/", async (WegoDbContext db) => Results.Ok(await LoadAsync(db)));

        // A step planned for one or more employees: in the fixed order, after the step before it and before the
        // one after it; planned again, it moves (it is there once, but for an Objektauswahl that needs another).
        group.MapPost("/{siteId:int}/steps", async (int siteId, StepInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var site = await db.Sites.FirstOrDefaultAsync(s => s.Id == siteId);
            if (site is null) return Results.NotFound();
            if (!IsOffer(site)) return ApiErrors.BadRequest("Die Baustelle ist nicht (mehr) im Angebot.");

            var steps = await StepActivitiesAsync(db);
            var index = steps.IndexOf(input.Activity);
            if (index < 0) return ApiErrors.BadRequest("Das ist kein Schritt der Angebotsphase.");
            if (input.StartTime >= input.EndTime) return ApiErrors.BadRequest("Das Ende muss nach dem Beginn liegen.");
            var employeeIds = (input.EmployeeIds ?? []).Distinct().ToList();
            if (employeeIds.Count == 0) return ApiErrors.BadRequest("Bitte angeben, wer den Termin macht.");

            var labels = await db.Activities.ToDictionaryAsync(a => a.Key, a => a.Label);
            var siteEntries = await db.PlanEntries.Where(e => e.SiteId == siteId && e.Activity != null && steps.Contains(e.Activity))
                .ToListAsync();
            // The step before has to be there, and this one comes after it (and before the step after it).
            if (index > 0)
            {
                var before = siteEntries.Where(e => e.Activity == steps[index - 1]).ToList();
                if (before.Count == 0)
                    return ApiErrors.BadRequest($"Erst kommt „{labels[steps[index - 1]]}“, dann „{labels[input.Activity]}“.");
                if (input.Date < before.Max(e => e.Date))
                    return ApiErrors.BadRequest($"„{labels[input.Activity]}“ kann nicht vor „{labels[steps[index - 1]]}“ ({before.Max(e => e.Date):dd.MM.yyyy}) liegen.");
            }
            if (index < steps.Count - 1 && siteEntries.Where(e => e.Activity == steps[index + 1]).ToList() is { Count: > 0 } after
                && input.Date > after.Min(e => e.Date))
                return ApiErrors.BadRequest($"„{labels[input.Activity]}“ kann nicht nach „{labels[steps[index + 1]]}“ ({after.Min(e => e.Date):dd.MM.yyyy}) liegen.");

            // Who does it: planners all steps, craftsmen those given to them (e.g. Besichtigung).
            var employees = await db.Employees.Where(e => employeeIds.Contains(e.Id) && e.IsActive).ToListAsync();
            if (employees.Count != employeeIds.Count) return ApiErrors.BadRequest("Einen der Mitarbeiter gibt es nicht (mehr).");
            if (employees.FirstOrDefault(e => !Roles.CanPlan(e.Role) && !e.AdditionalActivities.Contains(input.Activity)) is { } cannot)
                return ApiErrors.BadRequest($"{cannot.Name} macht keine {labels[input.Activity]}.");

            var own = siteEntries.Where(e => e.Activity == input.Activity).ToList();
            if (input.Another && !Repeatable.Contains(input.Activity))
                return ApiErrors.BadRequest($"„{labels[input.Activity]}“ gibt es nur einmal, der Termin kann verschoben werden.");
            if (input.Another && own.Count == 0)
                return ApiErrors.BadRequest($"Erst den ersten Termin für „{labels[input.Activity]}“ planen.");
            var moved = input.Another ? [] : input.From is { } from ? own.Where(e => e.Date == from).ToList() : own;
            if (input.From is not null && !input.Another && moved.Count == 0)
                return ApiErrors.BadRequest("Den Termin gibt es nicht mehr, bitte die Seite neu laden.");
            var movedIds = moved.Select(e => e.Id).ToHashSet();
            var note = moved.Select(e => e.Note).FirstOrDefault(n => n is not null);
            await using var transaction = await db.Database.BeginTransactionAsync();
            foreach (var employee in employees)
            {
                var day = await db.PlanEntries.Include(e => e.Site)
                    .Where(e => e.EmployeeId == employee.Id && e.Date == input.Date).ToListAsync();
                day = day.Where(e => !movedIds.Contains(e.Id)).ToList();
                // Time kept free ("verfügbar") gives way; anything else in the way is said.
                foreach (var free in day.Where(e => IsFree(e) && Overlaps(e, input)).ToList())
                {
                    db.PlanEntries.Remove(free);
                    day.Remove(free);
                }
                if (day.FirstOrDefault(e => Overlaps(e, input)) is { } taken)
                    return ApiErrors.BadRequest($"{employee.Name} hat am {input.Date:dd.MM.yyyy} schon {Describe(taken, labels)}.");
                if (day.Count >= PlanEndpoints.MaxEntriesPerDay)
                    return ApiErrors.BadRequest($"{employee.Name} hat am {input.Date:dd.MM.yyyy} schon {PlanEndpoints.MaxEntriesPerDay} Einträge.");
                db.PlanEntries.Add(new PlanEntry
                {
                    EmployeeId = employee.Id, Date = input.Date, Type = EntryType.Baustelle, SiteId = siteId,
                    Activity = input.Activity, StartTime = input.StartTime, EndTime = input.EndTime, Note = note,
                });
            }
            db.PlanEntries.RemoveRange(moved);
            ChangeLog.Add(db, user, ChangeArea.Baustelle, moved.Count > 0 ? "Termin verschoben" : input.Another ? "Weiterer Termin" : "Termin", siteId,
                moved.Count == 0 ? null : moved.Select(e => new { e.Activity, e.EmployeeId, e.Date, e.StartTime, e.EndTime }).ToList(),
                employees.Select(e => new { input.Activity, EmployeeId = e.Id, input.Date, input.StartTime, input.EndTime }).ToList());
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Ok(await LoadAsync(db));
        });

        // The customer says yes: the construction phase with its start, its activities come along.
        group.MapPost("/{siteId:int}/accept", async (int siteId, AcceptInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var site = await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == siteId);
            if (site is null) return Results.NotFound();
            if (!IsOffer(site)) return ApiErrors.BadRequest("Die Baustelle ist nicht (mehr) im Angebot.");
            var before = SiteEndpoints.ToDto(site);
            site.PlannedStart = input.PlannedStart;
            if (site.PlannedEnd < site.PlannedStart) site.PlannedEnd = null;
            ChangeStatus(db, user, site, SiteStatus.Bauphase);
            site.GenerateTasks(await db.Activities.ToListAsync());
            site.DeclineReason = null;
            site.DeclineNote = null;
            ChangeLog.Add(db, user, ChangeArea.Baustelle, "Zusage", siteId, before, SiteEndpoints.ToDto(site));
            await db.SaveChangesAsync();
            return Results.Ok(await LoadAsync(db));
        });

        // The customer says no, at any step: declined with the reason; appointments still ahead are taken out.
        group.MapPost("/{siteId:int}/decline", async (int siteId, DeclineInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var site = await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == siteId);
            if (site is null) return Results.NotFound();
            if (!IsOffer(site)) return ApiErrors.BadRequest("Die Baustelle ist nicht (mehr) im Angebot.");
            if (!DeclineReasons.Contains(input.Reason)) return ApiErrors.BadRequest("Bitte einen Grund der Absage wählen.");
            var note = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim();
            if (input.Reason == Other && note is null) return ApiErrors.BadRequest("Bei „Sonstiges“ bitte kurz den Grund angeben.");
            if (note?.Length > 500) return ApiErrors.BadRequest("Die Bemerkung darf höchstens 500 Zeichen lang sein.");

            var before = SiteEndpoints.ToDto(site);
            var today = DateOnly.FromDateTime(DateTime.Today);
            var ahead = await db.PlanEntries.Where(e => e.SiteId == siteId && e.Date > today).ToListAsync();
            db.PlanEntries.RemoveRange(ahead);
            site.DeclineReason = input.Reason;
            site.DeclineNote = note;
            ChangeStatus(db, user, site, SiteStatus.Abgelehnt);
            ChangeLog.Add(db, user, ChangeArea.Baustelle, "Abgelehnt", siteId, before, SiteEndpoints.ToDto(site));
            await db.SaveChangesAsync();
            return Results.Ok(await LoadAsync(db));
        });
    }

    /// <summary>An enquiry: a site in the offer, neither a service call nor an appointment not confirmed yet.</summary>
    private static bool IsOffer(Site site) => site.Status == SiteStatus.Angebot && !site.IsService && !site.IsTentative;

    private static bool IsFree(PlanEntry e) => e.Type == EntryType.Baustelle && e.SiteId is null && e.Activity is null;

    /// <summary>An entry without times takes the whole day.</summary>
    private static bool Overlaps(PlanEntry e, StepInput input) =>
        e.StartTime is null || e.EndTime is null || (e.StartTime < input.EndTime && input.StartTime < e.EndTime);

    private static string Describe(PlanEntry e, IReadOnlyDictionary<string, string> labels)
    {
        var what = e.Type != EntryType.Baustelle ? e.Type.ToString()
            : e.Site?.Name ?? (e.Activity is { } a && labels.TryGetValue(a, out var label) ? label : "einen Eintrag");
        return e.StartTime is { } start && e.EndTime is { } end ? $"{what} ({start:HH\\:mm}–{end:HH\\:mm})" : $"{what} (ganzer Tag)";
    }

    private static void ChangeStatus(WegoDbContext db, ClaimsPrincipal user, Site site, SiteStatus to)
    {
        db.SiteStatusChanges.Add(new SiteStatusChange
        {
            SiteId = site.Id, From = site.Status, To = to, ChangedAt = DateTime.UtcNow, ChangedBy = user.Identity?.Name,
        });
        site.Status = to;
    }

    private static async Task<List<string>> StepActivitiesAsync(WegoDbContext db) =>
        await db.Activities.Where(a => a.Phase == SiteStatus.Angebot && a.Key != "Anfrage")
            .OrderBy(a => a.SortOrder).Select(a => a.Key).ToListAsync();

    private static async Task<OffersDto> LoadAsync(WegoDbContext db)
    {
        await SiteEndpoints.StartDueSitesAsync(db);
        var steps = await StepActivitiesAsync(db);
        var sites = await db.Sites.AsNoTracking().Include(s => s.Tasks)
            .Where(s => s.Status == SiteStatus.Angebot && !s.IsService && !s.IsTentative)
            .OrderBy(s => s.RequestedOn).ThenBy(s => s.Name).ToListAsync();
        var ids = sites.Select(s => s.Id).ToList();
        var entries = await db.PlanEntries.AsNoTracking().Include(e => e.Employee)
            .Where(e => e.SiteId != null && ids.Contains(e.SiteId.Value) && e.Activity != null && steps.Contains(e.Activity))
            .OrderBy(e => e.Date).ThenBy(e => e.StartTime).ToListAsync();

        // Decided lately: the last change out of the offer, into the construction phase or declined.
        var since = DateTime.UtcNow.AddDays(-DecidedDays);
        var changes = await db.SiteStatusChanges.AsNoTracking().Include(c => c.Site)
            .Where(c => c.From == SiteStatus.Angebot && (c.To == SiteStatus.Bauphase || c.To == SiteStatus.Abgelehnt)
                && c.ChangedAt >= since && !c.Site.IsService)
            .OrderByDescending(c => c.ChangedAt).ToListAsync();
        var decided = changes.GroupBy(c => c.SiteId).Select(g => g.First())
            .Where(c => c.Site.Status == c.To)
            .Select(c => new DecidedDto(c.SiteId, c.Site.Name, c.To, c.ChangedAt, c.Site.PlannedStart, c.Site.DeclineReason, c.Site.DeclineNote))
            .ToList();

        return new OffersDto(sites.Select(SiteEndpoints.ToDto).ToList(),
            entries.Select(e => new StepDto(e.SiteId!.Value, e.Activity!, e.Id, e.EmployeeId, e.Employee.Name, e.Date, e.StartTime, e.EndTime)).ToList(),
            steps, decided);
    }
}
