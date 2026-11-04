using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>
/// Who may see the offer phase: the planners, who do all of its activities. Craftsmen get neither the sites in
/// the offer phase nor the offer work of others.
/// </summary>
public static class OfferAccess
{
    public record Rules(bool SeesOffers, int EmployeeId, IReadOnlySet<string> OfferActivities);

    public static async Task<Rules> ForAsync(ClaimsPrincipal user, WegoDbContext db)
    {
        var offerActivities = await OfferActivitiesAsync(db);
        return new Rules(user.CanPlan(), user.EmployeeId(), offerActivities);
    }

    /// <summary>For the signed-in user: whether the menu offers the plan of the offer phase.</summary>
    public static Task<bool> SeesOffersAsync(Employee employee, WegoDbContext db) => Task.FromResult(Roles.CanPlan(employee.Role));

    private static async Task<HashSet<string>> OfferActivitiesAsync(WegoDbContext db) =>
        (await db.Activities.Where(a => a.Phase == SiteStatus.Angebot).Select(a => a.Key).ToListAsync()).ToHashSet();

    public static bool Shows(this Rules rules, Site site) => rules.SeesOffers || site.Status != SiteStatus.Angebot;

    /// <summary>An entry of somebody else that is offer work: by its activity, or (without one) by its site.</summary>
    public static bool Shows(this Rules rules, PlanEntry entry, IReadOnlyDictionary<int, SiteStatus> siteStatus)
    {
        if (rules.SeesOffers || entry.EmployeeId == rules.EmployeeId || entry.Type != EntryType.Baustelle) return true;
        if (entry.Activity is not null) return !rules.OfferActivities.Contains(entry.Activity);
        return entry.SiteId is { } siteId && siteStatus.TryGetValue(siteId, out var status) && status != SiteStatus.Angebot;
    }
}
