using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>"Mein Bereich": what every signed-in employee may see about themselves, e.g. their vacation.</summary>
public static class MyEndpoints
{
    /// <summary>Vacation days are counted from this year on; before, they were kept elsewhere.</summary>
    public const int VacationCountedFrom = 2027;

    /// <summary>A stretch of vacation: days one after the other (a weekend in between does not break it).</summary>
    public record VacationBlock(DateOnly From, DateOnly To, decimal Days);

    /// <summary>
    /// <paramref name="Used"/>: all vacation days entered in the year, <paramref name="Taken"/> those up to today.
    /// <paramref name="Counted"/>: false before <see cref="VacationCountedFrom"/>, then there are no numbers.
    /// </summary>
    public record MyVacationDto(int Year, bool Counted, int CountedFrom, int Entitlement, decimal Used, decimal Taken,
        decimal Remaining, IReadOnlyList<VacationBlock> Blocks);

    /// <summary>
    /// 24 and 31 December are no public holidays, but work ends at noon: everybody takes half a day of vacation
    /// for each (on a weekday), whether entered in the plan or not.
    /// </summary>
    public static IEnumerable<DateOnly> HalfVacationDays(int year) =>
        new[] { new DateOnly(year, 12, 24), new DateOnly(year, 12, 31) }
            .Where(d => d.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday));

    public static void MapMyEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/me/vacation", async (int year, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var employee = await db.Employees.AsNoTracking().FirstOrDefaultAsync(e => e.Id == user.EmployeeId());
            if (employee is null) return Results.NotFound();
            if (year < VacationCountedFrom)
                return Results.Ok(new MyVacationDto(year, false, VacationCountedFrom, employee.VacationDaysPerYear, 0, 0,
                    employee.VacationDaysPerYear, []));

            var (from, to) = PlanEndpoints.YearRange(year);
            // Saturdays and Sundays do not use up vacation days (as in the reports).
            var days = (await db.PlanEntries.AsNoTracking()
                    .Where(e => e.EmployeeId == employee.Id && e.Type == EntryType.Urlaub && e.Date >= from && e.Date <= to)
                    .Select(e => e.Date)
                    .ToListAsync())
                .Where(d => d.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday))
                .Distinct()
                .Order()
                .ToList();

            // Full days, and the half days of 24 and 31 December (also when entered as a whole day of vacation).
            var halves = HalfVacationDays(year).ToList();
            var whole = days.Where(d => !halves.Contains(d)).ToList();
            var blocks = Blocks(whole).Concat(halves.Select(d => new VacationBlock(d, d, 0.5m))).OrderBy(b => b.From).ToList();

            var today = DateOnly.FromDateTime(DateTime.Today);
            var used = blocks.Sum(b => b.Days);
            var taken = whole.Count(d => d <= today) + 0.5m * halves.Count(d => d <= today);
            return Results.Ok(new MyVacationDto(year, true, VacationCountedFrom, employee.VacationDaysPerYear, used,
                taken, employee.VacationDaysPerYear - used, blocks));
        }).RequireAuthorization();
    }

    /// <summary>Joins the days (weekdays, in order) to stretches; only a weekend may lie between two of them.</summary>
    public static List<VacationBlock> Blocks(IReadOnlyList<DateOnly> days)
    {
        var blocks = new List<VacationBlock>();
        foreach (var day in days)
        {
            var last = blocks.Count > 0 ? blocks[^1] : null;
            if (last is not null && OnlyWeekendBetween(last.To, day))
                blocks[^1] = last with { To = day, Days = last.Days + 1 };
            else
                blocks.Add(new VacationBlock(day, day, 1));
        }
        return blocks;
    }

    private static bool OnlyWeekendBetween(DateOnly from, DateOnly to)
    {
        for (var day = from.AddDays(1); day < to; day = day.AddDays(1))
            if (day.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday)) return false;
        return true;
    }
}
