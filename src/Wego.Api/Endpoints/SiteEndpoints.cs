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
        string? LabelProjectNumber);

    public record TaskDto(Activity Activity, int EstimatedDays, bool NotNeeded);
    public record TaskInput(int EstimatedDays, bool NotNeeded);

    public record SiteInput(string? Client, string? Street, string? HouseNumber, string? AddressAddition,
        string? PostalCode, string? City, SiteNameSource NameSource, string? Description,
        DateOnly? PlannedStart = null, DateOnly? PlannedEnd = null, SiteStatus? Status = null,
        string? LabelProjectNumber = null);

    public record StatusRequest(SiteStatus Status);
    public record StatusChangeDto(SiteStatus? From, SiteStatus To, DateTime ChangedAt, string? ChangedBy);

    public record MergeRequest(int TargetId);

    public static void MapSiteEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/sites");

        // Everybody may read sites: the craftsmen need the addresses.
        group.MapGet("/", async (WegoDbContext db) =>
            (await db.Sites.AsNoTracking().Include(s => s.Tasks).OrderBy(s => s.Name).ToListAsync()).Select(ToDto));

        group.MapGet("/{id:int}", async (int id, WegoDbContext db) =>
            await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == id) is { } site
                ? Results.Ok(ToDto(site))
                : Results.NotFound());

        // A new site starts as offer (Angebot), or directly in construction when the offer was made elsewhere.
        group.MapPost("/", async (SiteInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var site = new Site { Status = input.Status ?? SiteStatus.Angebot };
            if (site.Status is not (SiteStatus.Angebot or SiteStatus.Bauphase))
                return ApiErrors.BadRequest("Eine neue Baustelle beginnt im Angebot oder in der Bauphase.");
            var error = Apply(site, input);
            if (error is not null) return ApiErrors.BadRequest(error);

            site.StatusChanges.Add(new SiteStatusChange
            {
                To = site.Status, ChangedAt = DateTime.UtcNow, ChangedBy = user.Identity?.Name,
            });
            site.GenerateTasks();
            db.Sites.Add(site);
            await db.SaveChangesAsync();
            return Results.Created($"/api/sites/{site.Id}", ToDto(site));
        }).RequireAuthorization(Roles.Planer);

        group.MapPut("/{id:int}", async (int id, SiteInput input, WegoDbContext db) =>
        {
            var site = await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == id);
            if (site is null) return Results.NotFound();

            var error = Apply(site, input);
            if (error is not null) return ApiErrors.BadRequest(error);

            await db.SaveChangesAsync();
            return Results.Ok(ToDto(site));
        }).RequireAuthorization(Roles.Planer);

        group.MapPost("/{id:int}/status", async (int id, StatusRequest request, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var site = await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == id);
            if (site is null) return Results.NotFound();
            if (!Enum.IsDefined(request.Status)) return ApiErrors.BadRequest("Unbekannter Status.");
            if (!ActivityPhases.CanChange(site.Status, request.Status))
                return ApiErrors.BadRequest($"Von „{site.Status}“ kann nicht zu „{request.Status}“ gewechselt werden.");

            db.SiteStatusChanges.Add(new SiteStatusChange
            {
                SiteId = id, From = site.Status, To = request.Status, ChangedAt = DateTime.UtcNow,
                ChangedBy = user.Identity?.Name,
            });
            site.Status = request.Status;
            // Entering a status brings its activities along.
            site.GenerateTasks();
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(site));
        }).RequireAuthorization(Roles.Planer);

        group.MapPut("/{id:int}/tasks/{activity}", async (int id, Activity activity, TaskInput input, WegoDbContext db) =>
        {
            if (input.EstimatedDays is < 1 or > 365) return ApiErrors.BadRequest("Bitte zwischen 1 und 365 Tagen angeben.");
            var site = await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == id);
            var task = site?.Tasks.FirstOrDefault(t => t.Activity == activity);
            if (site is null || task is null) return Results.NotFound();

            task.EstimatedDays = input.EstimatedDays;
            task.NotNeeded = input.NotNeeded;
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(site));
        }).RequireAuthorization(Roles.Planer);

        group.MapGet("/{id:int}/history", async (int id, WegoDbContext db) =>
            await db.SiteStatusChanges.Where(c => c.SiteId == id)
                .OrderBy(c => c.ChangedAt).ThenBy(c => c.Id)
                .Select(c => new StatusChangeDto(c.From, c.To, c.ChangedAt, c.ChangedBy))
                .ToListAsync()).RequireAuthorization(Roles.Planer);

        // Two records for the same site (e.g. typed twice): the entries move over, the duplicate goes.
        group.MapPost("/{id:int}/merge", async (int id, MergeRequest request, WegoDbContext db) =>
        {
            if (id == request.TargetId) return ApiErrors.BadRequest("Eine Baustelle lässt sich nicht mit sich selbst zusammenführen.");
            var site = await db.Sites.FindAsync(id);
            var target = await db.Sites.Include(s => s.Tasks).FirstOrDefaultAsync(s => s.Id == request.TargetId);
            if (site is null || target is null) return Results.NotFound();

            await using var transaction = await db.Database.BeginTransactionAsync();
            await db.PlanEntries.Where(e => e.SiteId == id)
                .ExecuteUpdateAsync(s => s.SetProperty(e => e.SiteId, target.Id));

            // The remaining site keeps its own details and takes over only what it is missing.
            target.Client ??= site.Client;
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

            db.Sites.Remove(site);
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Ok(ToDto(target));
        }).RequireAuthorization(Roles.Planer);

        group.MapDelete("/{id:int}", async (int id, WegoDbContext db) =>
        {
            if (await db.PlanEntries.AnyAsync(e => e.SiteId == id))
                return ApiErrors.BadRequest("Die Baustelle ist im Plan eingetragen und kann nicht gelöscht werden.");
            var deleted = await db.Sites.Where(s => s.Id == id).ExecuteDeleteAsync();
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        }).RequireAuthorization(Roles.Planer);
    }

    public static SiteDto ToDto(Site s) => new(s.Id, s.Name, s.Client, s.Street, s.HouseNumber, s.AddressAddition,
        s.PostalCode, s.City, s.NameSource, s.Description, s.PlannedStart, s.PlannedEnd, s.Status,
        s.Tasks.OrderBy(t => t.Activity).Select(t => new TaskDto(t.Activity, t.EstimatedDays, t.NotNeeded)).ToList(),
        s.LabelProjectNumber);

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
            (Clean(input.LabelProjectNumber), 50, "Die Projektnummer"),
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

        site.Client = client;
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
        site.UpdateName();
        return null;
    }
}
