using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>
/// The activities of the plan. Everybody reads them (colours and names in the plan); Planer G create,
/// rename, colour, order, move them to the other phase and delete them.
/// </summary>
public static partial class ActivityEndpoints
{
    public record ActivityDto(string Key, string Label, SiteStatus Phase, int SortOrder, string Color);
    public record ActivityInput(string Label, SiteStatus Phase, string Color);
    /// <summary>Where an activity is used: what deleting it would clear.</summary>
    public record UsageDto(int Entries, int Employees, int Sites);

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColor();

    public static void MapActivityEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/activities");

        group.MapGet("/", async (WegoDbContext db) =>
            await db.Activities.AsNoTracking().OrderBy(a => a.SortOrder).ThenBy(a => a.Label)
                .Select(a => ToDto(a)).ToListAsync());

        group.MapPost("/", async (ActivityInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var error = Validate(input);
            if (error is not null) return ApiErrors.BadRequest(error);
            var label = input.Label.Trim();
            if (await db.Activities.AnyAsync(a => a.Label.ToLower() == label.ToLower()))
                return ApiErrors.BadRequest("Eine Tätigkeit mit diesem Namen gibt es schon.");

            var activity = new ActivityType
            {
                Key = await UniqueKey(db, label),
                Label = label,
                Phase = input.Phase,
                Color = input.Color.ToLowerInvariant(),
                SortOrder = (await db.Activities.MaxAsync(a => (int?)a.SortOrder) ?? 0) + 1,
            };
            db.Activities.Add(activity);
            ChangeLog.Add(db, user, ChangeArea.Taetigkeit, "Angelegt", null, null, ToDto(activity));
            await db.SaveChangesAsync();
            return Results.Created($"/api/activities/{activity.Key}", ToDto(activity));
        }).RequireAuthorization(Policies.Admin);

        group.MapPut("/{key}", async (string key, ActivityInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var activity = await db.Activities.FindAsync(key);
            if (activity is null) return Results.NotFound();
            var error = Validate(input);
            if (error is not null) return ApiErrors.BadRequest(error);
            var label = input.Label.Trim();
            if (await db.Activities.AnyAsync(a => a.Key != key && a.Label.ToLower() == label.ToLower()))
                return ApiErrors.BadRequest("Eine Tätigkeit mit diesem Namen gibt es schon.");

            var before = ToDto(activity);
            activity.Label = label;
            activity.Phase = input.Phase;
            activity.Color = input.Color.ToLowerInvariant();
            ChangeLog.Add(db, user, ChangeArea.Taetigkeit, "Geändert", null, before, ToDto(activity));
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(activity));
        }).RequireAuthorization(Policies.Admin);

        // The new order of all activities, as their keys from first to last.
        group.MapPut("/order", async (string[] keys, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var activities = await db.Activities.ToListAsync();
            if (keys.Length != activities.Count || keys.Distinct().Count() != keys.Length ||
                keys.Any(key => activities.All(a => a.Key != key)))
            {
                return ApiErrors.BadRequest("Die Reihenfolge muss jede Tätigkeit genau einmal enthalten.");
            }

            var before = activities.OrderBy(a => a.SortOrder).Select(a => a.Key).ToList();
            foreach (var activity in activities) activity.SortOrder = Array.IndexOf(keys, activity.Key) + 1;
            ChangeLog.Add(db, user, ChangeArea.Taetigkeit, "Reihenfolge", null, before, keys);
            await db.SaveChangesAsync();
            return Results.Ok(activities.OrderBy(a => a.SortOrder).Select(ToDto).ToList());
        }).RequireAuthorization(Policies.Admin);

        group.MapGet("/{key}/usage", async (string key, WegoDbContext db) =>
        {
            if (!await db.Activities.AnyAsync(a => a.Key == key)) return Results.NotFound();
            var employees = (await db.Employees.AsNoTracking().ToListAsync())
                .Count(e => e.MainActivity == key || e.AdditionalActivities.Contains(key));
            return Results.Ok(new UsageDto(
                await db.PlanEntries.CountAsync(e => e.Activity == key),
                employees,
                await db.SiteTasks.CountAsync(t => t.Activity == key)));
        }).RequireAuthorization(Policies.Admin);

        // Plan entries keep their day and site but lose the activity, employees lose it as main or additional
        // activity, and the sites lose it as a task to plan.
        group.MapDelete("/{key}", async (string key, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var activity = await db.Activities.FindAsync(key);
            if (activity is null) return Results.NotFound();

            await using var transaction = await db.Database.BeginTransactionAsync();
            foreach (var employee in (await db.Employees.ToListAsync()).Where(e => e.AdditionalActivities.Contains(key)))
                employee.AdditionalActivities = employee.AdditionalActivities.Where(a => a != key).ToList();
            await db.SaveChangesAsync();

            // Entries and main activities are set to null, tasks deleted by the database (see WegoDbContext).
            db.Activities.Remove(activity);
            ChangeLog.Add(db, user, ChangeArea.Taetigkeit, "Gelöscht", null, ToDto(activity), null);
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.NoContent();
        }).RequireAuthorization(Policies.Admin);
    }

    private static ActivityDto ToDto(ActivityType a) => new(a.Key, a.Label, a.Phase, a.SortOrder, a.Color);

    private static string? Validate(ActivityInput input)
    {
        var label = input.Label?.Trim();
        if (string.IsNullOrEmpty(label) || label.Length > 100) return "Bitte einen Namen mit höchstens 100 Zeichen angeben.";
        if (input.Phase is not (SiteStatus.Angebot or SiteStatus.Bauphase))
            return "Eine Tätigkeit gehört zur Angebotsphase oder zur Bauphase.";
        if (input.Color is null || !HexColor().IsMatch(input.Color)) return "Bitte eine Farbe wie #3f51b5 angeben.";
        return null;
    }

    /// <summary>A key from the name, e.g. "Elektro-Arbeiten" → "ElektroArbeiten"; it never changes afterwards.</summary>
    private static async Task<string> UniqueKey(WegoDbContext db, string label)
    {
        var plain = label.Replace("ä", "ae").Replace("ö", "oe").Replace("ü", "ue")
            .Replace("Ä", "Ae").Replace("Ö", "Oe").Replace("Ü", "Ue").Replace("ß", "ss");
        var words = Regex.Split(plain, "[^A-Za-z0-9]+").Where(w => w.Length > 0);
        var key = string.Concat(words.Select(w => char.ToUpperInvariant(w[0]) + w[1..]));
        if (key.Length == 0) key = "Taetigkeit";
        if (key.Length > 26) key = key[..26];

        var candidate = key;
        for (var number = 2; await db.Activities.AnyAsync(a => a.Key == candidate); number++)
            candidate = $"{key}{number}";
        return candidate;
    }
}
