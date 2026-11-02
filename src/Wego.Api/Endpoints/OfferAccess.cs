using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>
/// Who may see the offer phase: planners, and craftsmen who do at least one of its activities (set at the
/// employee). Everybody else gets neither the sites in the offer phase nor the offer work of others.
/// </summary>
public static class OfferAccess
{
    public record Rules(bool SeesOffers, int EmployeeId, IReadOnlySet<string> OfferActivities);

    public static async Task<Rules> ForAsync(ClaimsPrincipal user, WegoDbContext db)
    {
        var offerActivities = await OfferActivitiesAsync(db);
        var id = user.EmployeeId();
        if (user.CanPlan()) return new Rules(true, id, offerActivities);

        var employee = await db.Employees.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id);
        return new Rules(employee is not null && Sees(employee, offerActivities), id, offerActivities);
    }

    /// <summary>For the signed-in user: whether the menu offers the plan of the offer phase.</summary>
    public static async Task<bool> SeesOffersAsync(Employee employee, WegoDbContext db) =>
        Roles.CanPlan(employee.Role) || Sees(employee, await OfferActivitiesAsync(db));

    private static async Task<HashSet<string>> OfferActivitiesAsync(WegoDbContext db) =>
        (await db.Activities.Where(a => a.Phase == SiteStatus.Angebot).Select(a => a.Key).ToListAsync()).ToHashSet();

    private static bool Sees(Employee employee, IReadOnlySet<string> offerActivities) =>
        Roles.CanPlan(employee.Role) ||
        employee.AdditionalActivities.Append(employee.MainActivity).Any(a => a is not null && offerActivities.Contains(a));

    public static bool Shows(this Rules rules, Site site) => rules.SeesOffers || site.Status != SiteStatus.Angebot;

    /// <summary>An entry of somebody else that is offer work: by its activity, or (without one) by its site.</summary>
    public static bool Shows(this Rules rules, PlanEntry entry, IReadOnlyDictionary<int, SiteStatus> siteStatus)
    {
        if (rules.SeesOffers || entry.EmployeeId == rules.EmployeeId || entry.Type != EntryType.Baustelle) return true;
        if (entry.Activity is not null) return !rules.OfferActivities.Contains(entry.Activity);
        return entry.SiteId is { } siteId && siteStatus.TryGetValue(siteId, out var status) && status != SiteStatus.Angebot;
    }
}
