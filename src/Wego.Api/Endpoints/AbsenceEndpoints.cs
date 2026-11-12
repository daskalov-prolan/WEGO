using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>
/// Urlaub and Krank under Verwaltung (Planer G): entered for a stretch of days, listed as such stretches. In the
/// plan they are the whole day of the employee, seen by everybody; what was planned on those days gives way.
/// </summary>
public static class AbsenceEndpoints
{
    /// <summary>
    /// A stretch of Urlaub or Krank: working days one after the other (a weekend or a public holiday in between
    /// does not break it).
    /// </summary>
    public record AbsenceDto(int EmployeeId, string EmployeeName, EntryType Type, DateOnly From, DateOnly To, int WorkDays);

    /// <summary>
    /// <paramref name="Force"/>: also over days with sites planned (they give way); without it those days are
    /// named and nothing is saved. <paramref name="Replaces"/>: the stretch changed, taken out first.
    /// </summary>
    public record AbsenceInput(int EmployeeId, EntryType Type, DateOnly From, DateOnly To, bool Force = false,
        AbsenceRange? Replaces = null);

    public record AbsenceRange(int EmployeeId, EntryType Type, DateOnly From, DateOnly To);

    /// <summary>The longest stretch entered at once.</summary>
    private const int MaxDays = 366;

    public static void MapAbsenceEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/absences").RequireAuthorization(Policies.Admin);

        group.MapGet("/", async (int year, WegoDbContext db) =>
        {
            var from = new DateOnly(year, 1, 1);
            var to = new DateOnly(year, 12, 31);
            var entries = await db.PlanEntries.AsNoTracking().Include(e => e.Employee)
                .Where(e => e.Type != EntryType.Baustelle && e.Date >= from && e.Date <= to)
                .OrderBy(e => e.EmployeeId).ThenBy(e => e.Date)
                .ToListAsync();
            return Results.Ok(Stretches(entries).OrderBy(a => a.From).ThenBy(a => a.EmployeeName).ToList());
        });

        group.MapPost("/", async (AbsenceInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (Check(input.Type, input.From, input.To) is { } error) return ApiErrors.BadRequest(error);
            if (input.Replaces is { } old && Check(old.Type, old.From, old.To) is { } oldError) return ApiErrors.BadRequest(oldError);
            var employee = await db.Employees.FirstOrDefaultAsync(e => e.Id == input.EmployeeId);
            if (employee is null) return ApiErrors.BadRequest("Den Mitarbeiter gibt es nicht.");

            var days = WorkDays(input.From, input.To).ToList();
            if (days.Count == 0) return ApiErrors.BadRequest("Im Zeitraum liegt kein Arbeitstag (nur Wochenende oder Feiertage).");

            // The stretch changed goes first, so that it is not in the way of itself.
            var removed = input.Replaces is { } replaces
                ? await db.PlanEntries.Where(e => e.EmployeeId == replaces.EmployeeId && e.Type == replaces.Type
                    && e.Date >= replaces.From && e.Date <= replaces.To).ToListAsync()
                : [];
            var removedIds = removed.Select(e => e.Id).ToHashSet();
            var existing = (await db.PlanEntries.Include(e => e.Site)
                    .Where(e => e.EmployeeId == input.EmployeeId && days.Contains(e.Date)).ToListAsync())
                .Where(e => !removedIds.Contains(e.Id)).ToList();

            // Sites planned on those days: said first, they give way only when it is confirmed.
            var planned = existing.Where(e => e.Type == EntryType.Baustelle && e.SiteId is not null)
                .OrderBy(e => e.Date).ThenBy(e => e.StartTime).ToList();
            if (planned.Count > 0 && !input.Force)
            {
                var list = string.Join(", ", planned.GroupBy(e => e.Date)
                    .Select(g => $"{Weekday(g.Key)} {g.Key:dd.MM.} {string.Join(" / ", g.Select(e => e.Site!.Name).Distinct())}"));
                return Results.Conflict(new { message = $"{employee.Name} ist eingeplant: {list}. Trotzdem eintragen? Die Baustellen an diesen Tagen werden dann entfernt." });
            }

            await using var transaction = await db.Database.BeginTransactionAsync();
            db.PlanEntries.RemoveRange(removed);
            db.PlanEntries.RemoveRange(existing);
            foreach (var day in days)
                db.PlanEntries.Add(new PlanEntry { EmployeeId = input.EmployeeId, Date = day, Type = input.Type });
            ChangeLog.Add(db, user, ChangeArea.Plan, input.Replaces is null ? "Abwesenheit" : "Abwesenheit geändert", input.EmployeeId,
                removed.Concat(existing).Select(e => new { e.Type, e.Date, e.SiteId, e.Activity }).ToList(),
                new { input.Type, input.From, input.To, Days = days.Count });
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Ok(new { days = days.Count, removedSites = planned.Count });
        });

        group.MapPost("/remove", async (AbsenceRange range, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (Check(range.Type, range.From, range.To) is { } error) return ApiErrors.BadRequest(error);
            var entries = await db.PlanEntries.Where(e => e.EmployeeId == range.EmployeeId && e.Type == range.Type
                && e.Date >= range.From && e.Date <= range.To).ToListAsync();
            db.PlanEntries.RemoveRange(entries);
            ChangeLog.Add(db, user, ChangeArea.Plan, "Abwesenheit gelöscht", range.EmployeeId, range, null);
            await db.SaveChangesAsync();
            return Results.Ok(new { days = entries.Count });
        });
    }

    private static string? Check(EntryType type, DateOnly from, DateOnly to)
    {
        if (type == EntryType.Baustelle || !Enum.IsDefined(type)) return "Bitte Urlaub oder Krank wählen.";
        if (to < from) return "Das Ende darf nicht vor dem Beginn liegen.";
        if (to.DayNumber - from.DayNumber >= MaxDays) return "Höchstens ein Jahr auf einmal.";
        return null;
    }

    private static bool IsWorkDay(DateOnly day) =>
        day.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday) && !BerlinHolidays.IsHoliday(day);

    /// <summary>Monday to Friday, without the public holidays of Berlin.</summary>
    private static IEnumerable<DateOnly> WorkDays(DateOnly from, DateOnly to)
    {
        for (var day = from; day <= to; day = day.AddDays(1))
            if (IsWorkDay(day)) yield return day;
    }

    private static string Weekday(DateOnly day) => day.DayOfWeek switch
    {
        DayOfWeek.Monday => "Mo", DayOfWeek.Tuesday => "Di", DayOfWeek.Wednesday => "Mi", DayOfWeek.Thursday => "Do",
        DayOfWeek.Friday => "Fr", DayOfWeek.Saturday => "Sa", _ => "So",
    };

    /// <summary>The entries (of one employee after the other, by date) joined into stretches.</summary>
    private static IEnumerable<AbsenceDto> Stretches(IEnumerable<PlanEntry> entries)
    {
        AbsenceDto? current = null;
        foreach (var entry in entries)
        {
            // Days off between two entries (a weekend, a public holiday) keep the stretch going.
            var follows = current is not null && current.EmployeeId == entry.EmployeeId && current.Type == entry.Type
                && WorkDays(current.To.AddDays(1), entry.Date.AddDays(-1)).All(_ => false);
            if (follows && entry.Date > current!.To)
            {
                current = current with { To = entry.Date, WorkDays = current.WorkDays + (IsWorkDay(entry.Date) ? 1 : 0) };
                continue;
            }
            if (follows) continue;
            if (current is not null) yield return current;
            current = new AbsenceDto(entry.EmployeeId, entry.Employee.Name, entry.Type, entry.Date, entry.Date, IsWorkDay(entry.Date) ? 1 : 0);
        }
        if (current is not null) yield return current;
    }
}
