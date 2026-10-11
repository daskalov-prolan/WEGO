using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;
using static Wego.Api.Endpoints.PlanEndpoints;

namespace Wego.Api.Endpoints;

public static class ReportEndpoints
{
    /// <summary>Days = number of days with at least one entry; Hours = sum of the time windows that were entered.</summary>
    public record ReportRow(int Id, string Name, int Days, double Hours);
    public record CustomerReportDto(int CustomerId, string CustomerName, int Year, int TotalDays, double TotalHours,
        IReadOnlyList<ReportRow> Employees, IReadOnlyList<EntryDto> Entries);

    public record VacationDto(int EmployeeId, string EmployeeName, int Entitlement, int Used, int Remaining,
        int SickDays);
    public record EmployeeReportDto(int EmployeeId, string EmployeeName, int Year, int TotalDays, double TotalHours,
        IReadOnlyList<ReportRow> Customers, IReadOnlyList<EntryDto> Entries, VacationDto Vacation);

    public static void MapReportEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/reports");

        group.MapGet("/customers/{id:int}", async (int id, int year, WegoDbContext db) =>
        {
            var customer = await db.Customers.FindAsync(id);
            if (customer is null) return Results.NotFound();

            var (from, to) = YearRange(year);
            var entries = Sort((await EntriesQuery(db)
                    .Where(e => e.CustomerId == id && e.Type == EntryType.Baustelle && e.Date >= from && e.Date <= to)
                    .ToListAsync())
                .Select(ToDto));

            var rows = entries
                .GroupBy(e => (e.EmployeeId, e.EmployeeName))
                .Select(g => ToRow(g.Key.EmployeeId, g.Key.EmployeeName, g))
                .OrderByDescending(r => r.Days).ThenBy(r => r.Name)
                .ToList();

            return Results.Ok(new CustomerReportDto(customer.Id, customer.Name, year,
                rows.Sum(r => r.Days), rows.Sum(r => r.Hours), rows, entries));
        }).RequireAuthorization(Roles.Planer);

        // Planners see every employee, everybody else only their own report.
        group.MapGet("/employees/{id:int}", async (int id, int year, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (!user.IsPlaner() && user.EmployeeId() != id) return Results.Forbid();

            var employee = await db.Employees.FindAsync(id);
            if (employee is null) return Results.NotFound();

            var (from, to) = YearRange(year);
            var all = await EntriesQuery(db)
                .Where(e => e.EmployeeId == id && e.Date >= from && e.Date <= to)
                .ToListAsync();

            var entries = Sort(all.Where(e => e.Type == EntryType.Baustelle).Select(ToDto));
            var rows = entries
                .GroupBy(e => (e.CustomerId, e.CustomerName))
                .Select(g => ToRow(g.Key.CustomerId ?? 0, g.Key.CustomerName ?? "", g))
                .OrderByDescending(r => r.Days).ThenBy(r => r.Name)
                .ToList();

            var vacation = ToVacation(employee, all);

            return Results.Ok(new EmployeeReportDto(employee.Id, employee.Name, year,
                entries.Select(e => e.Date).Distinct().Count(), rows.Sum(r => r.Hours), rows, entries, vacation));
        });

        group.MapGet("/vacation", async (int year, WegoDbContext db) =>
        {
            var (from, to) = YearRange(year);
            var absences = await db.PlanEntries.AsNoTracking()
                .Where(e => e.Type != EntryType.Baustelle && e.Date >= from && e.Date <= to)
                .ToListAsync();
            var byEmployee = absences.ToLookup(e => e.EmployeeId);

            var employees = await db.Employees.AsNoTracking()
                .Where(e => e.IsActive && e.ShowInPlan)
                .OrderBy(e => e.SortOrder).ThenBy(e => e.Name)
                .ToListAsync();

            return employees.Select(e => ToVacation(e, byEmployee[e.Id])).ToList();
        }).RequireAuthorization(Roles.Planer);
    }

    private static ReportRow ToRow(int id, string name, IEnumerable<EntryDto> entries)
    {
        var list = entries.ToList();
        return new ReportRow(id, name, list.Select(e => e.Date).Distinct().Count(), list.Sum(Hours));
    }

    private static double Hours(EntryDto entry) =>
        entry.StartTime is { } start && entry.EndTime is { } end ? (end - start).TotalHours : 0;

    private static VacationDto ToVacation(Employee employee, IEnumerable<PlanEntry> entries)
    {
        var list = entries.ToList();
        var used = CountWeekdays(list, EntryType.Urlaub);
        return new VacationDto(employee.Id, employee.Name, employee.VacationDaysPerYear, used,
            employee.VacationDaysPerYear - used, CountWeekdays(list, EntryType.Krank));
    }

    // Saturdays and Sundays do not use up vacation days.
    private static int CountWeekdays(IEnumerable<PlanEntry> entries, EntryType type) => entries
        .Where(e => e.Type == type && e.Date.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday))
        .Select(e => e.Date)
        .Distinct()
        .Count();
}
