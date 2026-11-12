using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>Construction sites (Baustellen): who ordered the job, where it is, and the name shown in the plan.</summary>
public static class SiteEndpoints
{
    public record SiteDto(int Id, string Name, string? Client, string? Street, string? HouseNumber,
        string? AddressAddition, string? PostalCode, string? City, SiteNameSource NameSource, string? Description,
        DateOnly? PlannedStart, DateOnly? PlannedEnd, SiteStatus Status, IReadOnlyList<TaskDto> Tasks,
        string? LabelProjectNumber, string? ClientPhone, int? ResponsiblePlannerId, bool IsService, bool IsTentative,
        DateOnly? RequestedOn = null, IReadOnlyList<string>? Scope = null,
        string? DeclineReason = null, string? DeclineNote = null, string? Salutation = null);

    public record TaskDto(string Activity, int EstimatedDays, bool NotNeeded);
    public record TaskInput(int EstimatedDays, bool NotNeeded);

    public record SiteInput(string? Client, string? Street, string? HouseNumber, string? AddressAddition,
        string? PostalCode, string? City, SiteNameSource NameSource, string? Description,
        DateOnly? PlannedStart = null, DateOnly? PlannedEnd = null, SiteStatus? Status = null,
        string? LabelProjectNumber = null, string? ClientPhone = null, int? ResponsiblePlannerId = null,
        bool? IsService = null, bool? IsTentative = null, DateOnly? RequestedOn = null,
        IReadOnlyList<string>? Scope = null, string? Salutation = null);

    /// <summary>How the customer is addressed (Anrede).</summary>
    public static readonly string[] Salutations = ["Herr", "Frau", "Familie"];

    public record StatusRequest(SiteStatus Status);

    /// <summary>The customer confirmed the appointment: it becomes a service call or a site.</summary>
    public record ConfirmRequest(bool AsService);
    public record StatusChangeDto(SiteStatus? From, SiteStatus To, DateTime ChangedAt, string? ChangedBy);

    public record MergeRequest(int TargetId);

    /// <summary>A planner who can be in charge of a site; <paramref name="IsMe"/> marks the signed-in one.</summary>
    public record PlannerDto(int Id, string Name, bool IsMe);

    public record HourlyRateDto(int EmployeeId, decimal HourlyRate);
    public record HourlyRateInput(decimal? HourlyRate);

    public static void MapSiteEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/sites");

        // Everybody may read sites: the craftsmen need the addresses. Sites in the offer phase only those
        // who may see it (see OfferAccess).
        group.MapGet("/", async (ClaimsPrincipal user, WegoDbContext db) =>
        {
            await StartDueSitesAsync(db);
            var access = await OfferAccess.ForAsync(user, db);
            return (await db.Sites.AsNoTracking().Include(s => s.Tasks).OrderBy(s => s.Name).ToListAsync())
                .Where(access.Shows).Select(ToDto);
        });

        // The planners who can be in charge of a site: the active Planer A and G.
        group.MapGet("/planners", async (ClaimsPrincipal user, WegoDbContext db) =>
        {
            var me = user.EmployeeId();
            return (await db.Employees.Where(e => e.IsActive && (e.Role == Roles.PlanerA || e.Role == Roles.PlanerG))
                    .OrderBy(e => e.Name).ToListAsync())
                .Select(e => new PlannerDto(e.Id, e.Name, e.Id == me));
        }).RequireAuthorization(Policies.Plan);

        group.MapGet("/{id:int}", async (int id, ClaimsPrincipal user, WegoDbContext db) =>
        {
            await StartDueSitesAsync(db);
            var site = await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == id);
            return site is not null && (await OfferAccess.ForAsync(user, db)).Shows(site)
                ? Results.Ok(ToDto(site))
                : Results.NotFound();
        });

        // A new site starts as offer (Angebot), or directly in construction when the offer was made elsewhere.
        group.MapPost("/", async (SiteInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var site = new Site { Status = input.Status ?? SiteStatus.Angebot, IsTentative = input.IsTentative ?? false };
            if (site.IsTentative && (site.Status != SiteStatus.Angebot || input.IsService == true))
                return ApiErrors.BadRequest("Ein unbestätigter Termin beginnt im Angebot und ohne Service.");
            if (site.Status is not (SiteStatus.Angebot or SiteStatus.Bauphase))
                return ApiErrors.BadRequest("Eine neue Baustelle beginnt im Angebot oder in der Bauphase.");
            var error = Apply(site, input) ?? await PlannerError(db, input.ResponsiblePlannerId);
            if (error is not null) return ApiErrors.BadRequest(error);
            // Without a choice, whoever creates the site is in charge of it.
            site.ResponsiblePlannerId = input.ResponsiblePlannerId ?? user.EmployeeId();
            // The enquiry came in today, unless another day is given.
            if (!site.IsService) site.RequestedOn ??= DateOnly.FromDateTime(DateTime.Today);

            site.StatusChanges.Add(new SiteStatusChange
            {
                To = site.Status, ChangedAt = DateTime.UtcNow, ChangedBy = user.Identity?.Name,
            });
            site.GenerateTasks(await db.Activities.ToListAsync());
            await using var transaction = await db.Database.BeginTransactionAsync();
            db.Sites.Add(site);
            await db.SaveChangesAsync();
            // The id exists only after the first save.
            ChangeLog.Add(db, user, ChangeArea.Baustelle, "Angelegt", site.Id, null, ToDto(site));
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Created($"/api/sites/{site.Id}", ToDto(site));
        }).RequireAuthorization(Policies.Plan);

        group.MapPut("/{id:int}", async (int id, SiteInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var site = await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == id);
            if (site is null) return Results.NotFound();

            var before = ToDto(site);
            var error = Apply(site, input) ?? await PlannerError(db, input.ResponsiblePlannerId);
            if (error is not null) return ApiErrors.BadRequest(error);
            site.ResponsiblePlannerId = input.ResponsiblePlannerId;

            ChangeLog.Add(db, user, ChangeArea.Baustelle, "Geändert", id, before, ToDto(site));
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(site));
        }).RequireAuthorization(Policies.Plan);

        group.MapPost("/{id:int}/status", async (int id, StatusRequest request, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var site = await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == id);
            if (site is null) return Results.NotFound();
            if (!Enum.IsDefined(request.Status)) return ApiErrors.BadRequest("Unbekannter Status.");
            // Done, or back from done: the management (Planer G) only.
            if ((request.Status == SiteStatus.Abgeschlossen || site.Status == SiteStatus.Abgeschlossen) && !user.IsPlanerG())
                return ApiErrors.BadRequest("Baustellen setzt nur die Geschäftsleitung (Planer G) auf erledigt.");
            if (!SiteStatusFlow.CanChange(site.Status, request.Status))
                return ApiErrors.BadRequest($"Von „{site.Status}“ kann nicht zu „{request.Status}“ gewechselt werden.");

            var before = ToDto(site);
            db.SiteStatusChanges.Add(new SiteStatusChange
            {
                SiteId = id, From = site.Status, To = request.Status, ChangedAt = DateTime.UtcNow,
                ChangedBy = user.Identity?.Name,
            });
            site.Status = request.Status;
            // Entering a status brings its activities along.
            site.GenerateTasks(await db.Activities.ToListAsync());
            ChangeLog.Add(db, user, ChangeArea.Baustelle, "Status", id, before, ToDto(site));
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(site));
        }).RequireAuthorization(Policies.Plan);

        // The customer confirmed: a service call or a site in the Bauphase, beginning on its first day. Its days
        // without an activity get the one the employee usually does there.
        group.MapPost("/{id:int}/confirm", async (int id, ConfirmRequest request, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var site = await db.Sites.Include(s => s.Tasks).Include(s => s.Entries).ThenInclude(e => e.Employee)
                .FirstOrDefaultAsync(s => s.Id == id);
            if (site is null) return Results.NotFound();
            if (!site.IsTentative) return ApiErrors.BadRequest("Dieser Termin ist schon bestätigt.");

            var before = ToDto(site);
            site.IsTentative = false;
            site.IsService = request.AsService;
            site.PlannedStart ??= site.Entries.Count > 0 ? site.Entries.Min(e => e.Date) : null;
            if (site.Status != SiteStatus.Bauphase)
            {
                db.SiteStatusChanges.Add(new SiteStatusChange
                {
                    SiteId = id, From = site.Status, To = SiteStatus.Bauphase, ChangedAt = DateTime.UtcNow,
                    ChangedBy = user.Identity?.Name,
                });
                site.Status = SiteStatus.Bauphase;
            }
            var activities = await db.Activities.ToListAsync();
            var construction = activities.Where(a => a.Phase == SiteStatus.Bauphase).OrderBy(a => a.SortOrder)
                .Select(a => a.Key).ToList();
            foreach (var entry in site.Entries.Where(e => e.Type == EntryType.Baustelle && e.Activity is null))
            {
                var own = new[] { entry.Employee.MainActivity }.Concat(entry.Employee.AdditionalActivities);
                entry.Activity = own.FirstOrDefault(a => a is not null && construction.Contains(a));
            }
            site.UpdateName();
            site.GenerateTasks(activities);
            ChangeLog.Add(db, user, ChangeArea.Baustelle, "Bestätigt", id, before, ToDto(site));
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(site));
        }).RequireAuthorization(Policies.Plan);

        group.MapPut("/{id:int}/tasks/{activity}", async (int id, string activity, TaskInput input,
            ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (input.EstimatedDays is < 1 or > 365) return ApiErrors.BadRequest("Bitte zwischen 1 und 365 Tagen angeben.");
            var site = await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == id);
            var task = site?.Tasks.FirstOrDefault(t => t.Activity == activity);
            if (site is null || task is null) return Results.NotFound();

            var before = ToDto(site);
            task.EstimatedDays = input.EstimatedDays;
            task.NotNeeded = input.NotNeeded;
            ChangeLog.Add(db, user, ChangeArea.Baustelle, "Tätigkeit geändert", id, before, ToDto(site));
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(site));
        }).RequireAuthorization(Policies.Plan);

        group.MapGet("/{id:int}/history", async (int id, WegoDbContext db) =>
            await db.SiteStatusChanges.Where(c => c.SiteId == id)
                .OrderBy(c => c.ChangedAt).ThenBy(c => c.Id)
                .Select(c => new StatusChangeDto(c.From, c.To, c.ChangedAt, c.ChangedBy))
                .ToListAsync()).RequireAuthorization(Policies.Plan);

        // The wages per hour that differ on this site from the usual ones of the employees (Planer G only).
        group.MapGet("/{id:int}/hourly-rates", async (int id, WegoDbContext db) =>
            await HourlyRates(db, id)).RequireAuthorization(Policies.Admin);

        // Changes the wage of an employee on this site only; empty goes back to the usual one.
        group.MapPut("/{id:int}/hourly-rates/{employeeId:int}", async (int id, int employeeId, HourlyRateInput input,
            ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (input.HourlyRate is < 0 or > 1000) return ApiErrors.BadRequest("Bitte einen Stundensatz zwischen 0 und 1000 € angeben.");
            var site = await db.Sites.FindAsync(id);
            var employee = await db.Employees.FindAsync(employeeId);
            if (site is null || employee is null) return Results.NotFound();

            var rate = await db.SiteHourlyRates.FindAsync(id, employeeId);
            var before = rate?.HourlyRate;
            var after = input.HourlyRate is { } value ? Math.Round(value, 2) : (decimal?)null;
            if (after is { } newRate)
            {
                if (rate is null) db.SiteHourlyRates.Add(rate = new SiteHourlyRate { SiteId = id, EmployeeId = employeeId });
                rate.HourlyRate = newRate;
            }
            else if (rate is not null)
            {
                db.SiteHourlyRates.Remove(rate);
            }

            ChangeLog.Add(db, user, ChangeArea.Baustelle, "Stundensatz", id,
                new { EmployeeId = employeeId, Employee = employee.Name, HourlyRate = before },
                new { EmployeeId = employeeId, Employee = employee.Name, HourlyRate = after });
            await db.SaveChangesAsync();
            return Results.Ok(await HourlyRates(db, id));
        }).RequireAuthorization(Policies.Admin);

        // Two records for the same site (e.g. typed twice): the entries move over, the duplicate goes.
        group.MapPost("/{id:int}/merge", async (int id, MergeRequest request, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (id == request.TargetId) return ApiErrors.BadRequest("Eine Baustelle lässt sich nicht mit sich selbst zusammenführen.");
            var site = await db.Sites.Include(s => s.Tasks).Include(s => s.HourlyRates).FirstOrDefaultAsync(s => s.Id == id);
            var target = await db.Sites.Include(s => s.Tasks).Include(s => s.HourlyRates)
                .FirstOrDefaultAsync(s => s.Id == request.TargetId);
            if (site is null || target is null) return Results.NotFound();

            var targetBefore = ToDto(target);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var moved = await db.PlanEntries.Where(e => e.SiteId == id)
                .ExecuteUpdateAsync(s => s.SetProperty(e => e.SiteId, target.Id));

            // The remaining site keeps its own details and takes over only what it is missing.
            target.Client ??= site.Client;
            target.ResponsiblePlannerId ??= site.ResponsiblePlannerId;
            target.ClientPhone ??= site.ClientPhone;
            target.Salutation ??= site.Salutation;
            if (target.Street is null)
            {
                target.Street = site.Street;
                target.HouseNumber = site.HouseNumber;
                target.AddressAddition = site.AddressAddition;
                target.PostalCode = site.PostalCode;
                target.City = site.City;
            }
            target.Description ??= site.Description;
            target.LabelProjectNumber ??= site.LabelProjectNumber;
            target.PlannedStart ??= site.PlannedStart;
            target.PlannedEnd ??= site.PlannedEnd;
            target.UpdateName();
            // Wages changed on the duplicate stay, unless the remaining site has its own.
            foreach (var rate in site.HourlyRates.Where(r => target.HourlyRates.All(t => t.EmployeeId != r.EmployeeId)).ToList())
                target.HourlyRates.Add(new SiteHourlyRate { EmployeeId = rate.EmployeeId, HourlyRate = rate.HourlyRate });

            // The plan entries move without a log entry per day: these two entries say which site they came from.
            ChangeLog.Add(db, user, ChangeArea.Baustelle, "Zusammengeführt, gelöscht", id, ToDto(site),
                new { TargetId = target.Id, MovedEntries = moved });
            ChangeLog.Add(db, user, ChangeArea.Baustelle, "Zusammengeführt", target.Id,
                targetBefore, new { Site = ToDto(target), MergedSiteId = id, MovedEntries = moved });
            db.Sites.Remove(site);
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Ok(ToDto(target));
        }).RequireAuthorization(Policies.Plan);

        // A site with entries in the plan goes only when asked again (withEntries): its entries go with it,
        // each day logged as a change of the plan.
        group.MapDelete("/{id:int}", async (int id, bool? withEntries, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var site = await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == id);
            if (site is null) return Results.NotFound();

            var entries = await db.PlanEntries.Where(e => e.SiteId == id).OrderBy(e => e.Date).ToListAsync();
            if (entries.Count > 0 && withEntries != true)
                return Results.Conflict(new
                {
                    message = $"„{site.Name}“ hat {entries.Count} {(entries.Count == 1 ? "Eintrag" : "Einträge")} im Plan.",
                    entries = entries.Count,
                });

            foreach (var entry in entries)
                ChangeLog.Add(db, user, ChangeArea.Plan, "Gelöscht", entry.EmployeeId,
                    new { entry.Type, entry.SiteId, SiteName = site.Name, entry.Activity, entry.StartTime, entry.EndTime, entry.Note },
                    null, entry.Date);
            db.PlanEntries.RemoveRange(entries);
            ChangeLog.Add(db, user, ChangeArea.Baustelle, "Gelöscht", id, ToDto(site), null);
            db.Sites.Remove(site);
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization(Policies.Plan);
    }

    private static Task<List<HourlyRateDto>> HourlyRates(WegoDbContext db, int siteId) =>
        db.SiteHourlyRates.Where(r => r.SiteId == siteId)
            .Select(r => new HourlyRateDto(r.EmployeeId, r.HourlyRate))
            .ToListAsync();

    /// <summary>The name in the status history of a site that entered the construction phase by itself.</summary>
    public const string AutomaticStart = "automatisch (Baubeginn erreicht)";

    /// <summary>
    /// Sites in the offer phase whose planned start has come go into the construction phase by themselves,
    /// with its activities, as if a planner had pressed "Bauphase beginnen". Runs before sites are read.
    /// </summary>
    public static async Task StartDueSitesAsync(WegoDbContext db)
    {
        var today = DateOnly.FromDateTime(DateTime.Today);
        var due = await db.Sites.Include(s => s.Tasks)
            .Where(s => s.Status == SiteStatus.Angebot && s.PlannedStart != null && s.PlannedStart <= today)
            .ToListAsync();
        if (due.Count == 0) return;
        var activities = await db.Activities.ToListAsync();
        foreach (var site in due)
        {
            db.SiteStatusChanges.Add(new SiteStatusChange
            {
                SiteId = site.Id, From = site.Status, To = SiteStatus.Bauphase, ChangedAt = DateTime.UtcNow,
                ChangedBy = AutomaticStart,
            });
            site.Status = SiteStatus.Bauphase;
            site.GenerateTasks(activities);
        }
        await db.SaveChangesAsync();
    }

    public static SiteDto ToDto(Site s) => new(s.Id, s.Name, s.Client, s.Street, s.HouseNumber, s.AddressAddition,
        s.PostalCode, s.City, s.NameSource, s.Description, s.PlannedStart, s.PlannedEnd, s.Status,
        // In the order they were generated: that of the activities when the site entered the status.
        s.Tasks.OrderBy(t => t.Id).Select(t => new TaskDto(t.Activity, t.EstimatedDays, t.NotNeeded)).ToList(),
        s.LabelProjectNumber, s.ClientPhone, s.ResponsiblePlannerId, s.IsService, s.IsTentative, s.RequestedOn,
        s.Scope, s.DeclineReason, s.DeclineNote, s.Salutation);

    private static async Task<string?> PlannerError(WegoDbContext db, int? plannerId) =>
        plannerId is { } id && !await db.Employees.AnyAsync(e => e.Id == id && (e.Role == Roles.PlanerA || e.Role == Roles.PlanerG))
            ? "Zuständig kann nur ein Planer sein."
            : null;

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string? Apply(Site site, SiteInput input)
    {
        if (!Enum.IsDefined(input.NameSource)) return "Unbekannte Namensquelle.";

        var client = Clean(input.Client);
        var street = Clean(input.Street);
        var fields = new (string? Value, int Max, string Label)[]
        {
            (client, 200, "Der Auftraggeber"), (street, 200, "Die Straße"), (Clean(input.HouseNumber), 20, "Die Hausnummer"),
            (Clean(input.AddressAddition), 200, "Der Adresszusatz"), (Clean(input.PostalCode), 10, "Die PLZ"),
            (Clean(input.City), 100, "Der Ort"), (Clean(input.Description), 1000, "Die Beschreibung"),
            (Clean(input.LabelProjectNumber), 50, "Die Projektnummer"), (Clean(input.ClientPhone), 50, "Die Telefonnummer"),
        };
        foreach (var (value, max, label) in fields)
        {
            if (value?.Length > max) return $"{label} darf höchstens {max} Zeichen lang sein.";
        }

        if (input.NameSource == SiteNameSource.Auftraggeber && client is null)
            return "Bitte einen Auftraggeber angeben, er ist der Name der Baustelle.";
        if (input.NameSource == SiteNameSource.Strasse && street is null)
            return "Bitte eine Straße angeben, sie ist der Name der Baustelle.";
        if (input.PlannedEnd < input.PlannedStart)
            return "Das geplante Ende darf nicht vor dem geplanten Start liegen.";
        if (input.RequestedOn > DateOnly.FromDateTime(DateTime.Today))
            return "Die Anfrage kann nicht in der Zukunft liegen.";
        if (Clean(input.Salutation) is { } salutation && !Salutations.Contains(salutation))
            return $"Unbekannte Anrede „{salutation}“.";
        if (input.Scope?.FirstOrDefault(s => !OfferEndpoints.Scopes.Contains(s)) is { } unknown)
            return $"Unbekannter Umfang „{unknown}“.";

        site.Client = client;
        site.ClientPhone = Clean(input.ClientPhone);
        site.Salutation = Clean(input.Salutation);
        site.Street = street;
        site.HouseNumber = Clean(input.HouseNumber);
        site.AddressAddition = Clean(input.AddressAddition);
        site.PostalCode = Clean(input.PostalCode);
        site.City = Clean(input.City);
        site.NameSource = input.NameSource;
        site.Description = Clean(input.Description);
        site.LabelProjectNumber = Clean(input.LabelProjectNumber);
        site.PlannedStart = input.PlannedStart;
        site.PlannedEnd = input.PlannedEnd;
        // Left out: the scope stays as it is.
        if (input.Scope is { } scope) site.Scope = OfferEndpoints.Scopes.Where(scope.Contains).ToList();
        // Left out: the day of the enquiry stays as it is.
        if (input.RequestedOn is { } requested) site.RequestedOn = requested;
        // Left out: it stays as it is (a site does not turn into a service call by being changed).
        if (input.IsService is { } isService) site.IsService = isService;
        // Only a new site starts as not confirmed; afterwards it is confirmed (see confirm), not changed back.
        if (input.IsTentative is false) site.IsTentative = false;
        site.UpdateName();
        return null;
    }
}
