using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

public static class EmployeeEndpoints
{
    public record EmployeeListItem(int Id, string Name);
    public record EmployeeOverviewDto(int Id, string Name, string Role, bool IsActive, bool ShowInPlan, string? Phone,
        bool IsDeleted);
    public record EmployeeDto(int Id, string Name, int SortOrder, bool IsActive, bool ShowInPlan,
        int VacationDaysPerYear, string? UserName, string Role, bool HasPassword, string? MainActivity,
        IReadOnlyList<string> AdditionalActivities, decimal? HourlyRate, string? Phone, bool IsDeleted);

    /// <summary>Password is only changed when it is not empty.</summary>
    /// <summary>The initial password is returned once and stored only as a hash.</summary>
    public record AccessDto(int EmployeeId, string Name, string UserName, string InitialPassword);

    public record EmployeeInput(string Name, int SortOrder, bool IsActive, bool ShowInPlan, int VacationDaysPerYear,
        string? UserName, string Role, string? Password, string? MainActivity = null,
        string[]? AdditionalActivities = null, decimal? HourlyRate = null, string? Phone = null);

    public static void MapEmployeeEndpoints(this IEndpointRouteBuilder app)
    {
        // Names only, for the selection in the employee report.
        app.MapGet("/api/employees/names", async (WegoDbContext db) =>
            await db.Employees
                .Where(e => e.ShowInPlan)
                .OrderBy(e => e.SortOrder).ThenBy(e => e.Name)
                .Select(e => new EmployeeListItem(e.Id, e.Name))
                .ToListAsync()).RequireAuthorization(Policies.Admin);

        // The list of employees for everybody: role and telephone, nothing of login or wage.
        app.MapGet("/api/employees/overview", async (WegoDbContext db) =>
            // The deleted ones at the end.
            await db.Employees.OrderBy(e => e.DeletedAt != null).ThenBy(e => e.SortOrder).ThenBy(e => e.Name)
                .Select(e => new EmployeeOverviewDto(e.Id, e.Name, e.Role, e.IsActive, e.ShowInPlan, e.Phone, e.DeletedAt != null))
                .ToListAsync()).RequireAuthorization();

        var group = app.MapGroup("/api/employees").RequireAuthorization(Policies.Admin);

        group.MapGet("/", async (WegoDbContext db) =>
            (await db.Employees.OrderBy(e => e.DeletedAt != null).ThenBy(e => e.SortOrder).ThenBy(e => e.Name).ToListAsync())
            .Select(ToDto));

        group.MapPost("/", async (EmployeeInput input, ClaimsPrincipal user, WegoDbContext db,
            IPasswordHasher<Employee> hasher) =>
        {
            var employee = new Employee { Name = "" };
            var error = await Apply(employee, input, db, hasher);
            if (error is not null) return ApiErrors.BadRequest(error);

            await using var transaction = await db.Database.BeginTransactionAsync();
            db.Employees.Add(employee);
            await db.SaveChangesAsync();
            // The id exists only after the first save.
            ChangeLog.Add(db, user, ChangeArea.Mitarbeiter, "Angelegt", employee.Id, null, ToDto(employee));
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            // A new craftsman gets the vacation of the company closures.
            await SchoolHolidayEndpoints.CatchUpClosuresAsync(db);
            return Results.Created($"/api/employees/{employee.Id}", ToDto(employee));
        });

        group.MapPut("/{id:int}", async (int id, EmployeeInput input, ClaimsPrincipal user, WegoDbContext db,
            IPasswordHasher<Employee> hasher) =>
        {
            var employee = await db.Employees.FindAsync(id);
            if (employee is null) return Results.NotFound();
            if (employee.DeletedAt is not null) return ApiErrors.BadRequest("Dieser Mitarbeiter ist gelöscht.");

            var before = ToDto(employee);
            var error = await Apply(employee, input, db, hasher);
            if (error is not null) return ApiErrors.BadRequest(error);

            // Nobody must be able to lock everyone out of the administration.
            var otherAdmins = await db.Employees.AnyAsync(e =>
                e.Id != id && e.IsActive && e.Role == Roles.PlanerG && e.UserName != null && e.PasswordHash != null);
            if (!otherAdmins && !IsActiveAdmin(employee))
                return ApiErrors.BadRequest("Es muss mindestens ein aktiver Planer G mit Anmeldung übrig bleiben.");

            // A new password is logged as such, never the password or its hash.
            ChangeLog.Add(db, user, ChangeArea.Mitarbeiter,
                string.IsNullOrEmpty(input.Password) ? "Geändert" : "Geändert, Passwort gesetzt",
                id, before, ToDto(employee));
            await db.SaveChangesAsync();
            // Made a craftsman or active again: the company closures come with it.
            await SchoolHolidayEndpoints.CatchUpClosuresAsync(db);
            return Results.Ok(ToDto(employee));
        });

        // Deletes an employee: the entries in the plan stay (as history), the login goes, and the lists show them
        // at the end as deleted. Nobody deletes themselves, and one Planer G with a login stays.
        group.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var employee = await db.Employees.FindAsync(id);
            if (employee is null) return Results.NotFound();
            if (employee.DeletedAt is not null) return Results.NoContent();
            if (id == user.EmployeeId()) return ApiErrors.BadRequest("Sie können sich nicht selbst löschen.");
            var otherAdmins = await db.Employees.AnyAsync(e =>
                e.Id != id && e.IsActive && e.Role == Roles.PlanerG && e.UserName != null && e.PasswordHash != null);
            if (!otherAdmins) return ApiErrors.BadRequest("Es muss mindestens ein aktiver Planer G mit Anmeldung übrig bleiben.");

            var before = ToDto(employee);
            employee.DeletedAt = DateTime.UtcNow;
            employee.IsActive = false;
            employee.UserName = null;
            employee.PasswordHash = null;
            employee.MustChangePassword = false;
            ChangeLog.Add(db, user, ChangeArea.Mitarbeiter, "Gelöscht", id, before, ToDto(employee));
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // A deleted employee for good: gone from every list and from the plan, with their entries, notes, vacation of
        // company closures and rates of sites. Only the change log keeps that it happened.
        group.MapDelete("/{id:int}/permanently", async (int id, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var employee = await db.Employees.FindAsync(id);
            if (employee is null) return Results.NotFound();
            if (employee.DeletedAt is null)
                return ApiErrors.BadRequest("Nur ein gelöschter Mitarbeiter kann endgültig gelöscht werden.");

            await using var transaction = await db.Database.BeginTransactionAsync();
            var before = ToDto(employee);
            db.PlanEntries.RemoveRange(await db.PlanEntries.Where(e => e.EmployeeId == id).ToListAsync());
            db.CalendarNotes.RemoveRange(await db.CalendarNotes.Where(n => n.EmployeeId == id).ToListAsync());
            db.ClosureVacations.RemoveRange(await db.ClosureVacations.Where(v => v.EmployeeId == id).ToListAsync());
            db.SiteHourlyRates.RemoveRange(await db.SiteHourlyRates.Where(r => r.EmployeeId == id).ToListAsync());
            foreach (var site in await db.Sites.Where(s => s.ResponsiblePlannerId == id).ToListAsync())
                site.ResponsiblePlannerId = null;
            db.Employees.Remove(employee);
            ChangeLog.Add(db, user, ChangeArea.Mitarbeiter, "Endgültig gelöscht", id, before, null);
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.NoContent();
        });

        // Creates the login of an employee (user name from the name) or resets a forgotten password.
        // The employee has to choose their own password at the first sign-in.
        group.MapPost("/{id:int}/access", async (int id, ClaimsPrincipal user, WegoDbContext db,
            IPasswordHasher<Employee> hasher) =>
        {
            var employee = await db.Employees.FindAsync(id);
            if (employee is null) return Results.NotFound();
            if (!employee.IsActive) return ApiErrors.BadRequest("Für inaktive oder gelöschte Mitarbeiter gibt es keinen Zugang.");

            var before = ToDto(employee);
            employee.UserName ??= await UniqueUserName(db, employee.Name);
            var password = NewInitialPassword();
            employee.PasswordHash = hasher.HashPassword(employee, password);
            employee.MustChangePassword = true;
            ChangeLog.Add(db, user, ChangeArea.Mitarbeiter,
                before.HasPassword ? "Passwort zurückgesetzt" : "Zugang angelegt", id, before, ToDto(employee));
            await db.SaveChangesAsync();

            return Results.Ok(new AccessDto(employee.Id, employee.Name, employee.UserName, password));
        });
    }

    private static async Task<string> UniqueUserName(WegoDbContext db, string name)
    {
        var slug = name.Trim().ToLowerInvariant()
            .Replace("ä", "ae").Replace("ö", "oe").Replace("ü", "ue").Replace("ß", "ss");
        slug = string.Join('.', new string(slug.Select(c => c is >= 'a' and <= 'z' or >= '0' and <= '9' ? c : ' ').ToArray())
            .Split(' ', StringSplitOptions.RemoveEmptyEntries));
        if (slug.Length == 0) slug = "benutzer";

        var candidate = slug;
        for (var number = 2; await db.Employees.AnyAsync(e => e.UserName == candidate); number++)
            candidate = $"{slug}{number}";
        return candidate;
    }

    // Without characters that are easily confused when read from a note (0/O, 1/l/I).
    private const string PasswordAlphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

    private static string NewInitialPassword() =>
        new(RandomNumberGenerator.GetItems<char>(PasswordAlphabet, 10));

    private static bool IsActiveAdmin(Employee e) =>
        e.IsActive && e.Role == Roles.PlanerG && e.UserName is not null && e.PasswordHash is not null;

    private static async Task<string?> Apply(Employee employee, EmployeeInput input, WegoDbContext db,
        IPasswordHasher<Employee> hasher)
    {
        var name = input.Name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > 200)
            return "Bitte einen Namen mit höchstens 200 Zeichen angeben.";
        if (!Roles.All.Contains(input.Role)) return "Unbekannte Rolle.";
        if (input.VacationDaysPerYear is < 0 or > 366) return "Bitte gültige Urlaubstage pro Jahr angeben.";
        var additional = input.AdditionalActivities ?? [];
        if (input.HourlyRate is < 0 or > 1000) return "Bitte einen Stundensatz zwischen 0 und 1000 € angeben.";
        if (input.Phone?.Trim().Length > 50) return "Die Telefonnummer darf höchstens 50 Zeichen lang sein.";
        var activities = await db.Activities.OrderBy(a => a.SortOrder).Select(a => a.Key).ToListAsync();
        if (input.MainActivity is { } main && !activities.Contains(main) || additional.Any(a => !activities.Contains(a)))
            return "Unbekannte Tätigkeit.";

        var userName = AuthEndpoints.NormalizeUserName(input.UserName);
        if (userName?.Length > 100) return "Der Benutzername darf höchstens 100 Zeichen lang sein.";
        if (userName is not null &&
            await db.Employees.AnyAsync(e => e.UserName == userName && e.Id != employee.Id))
        {
            return "Dieser Benutzername ist bereits vergeben.";
        }

        if (!string.IsNullOrEmpty(input.Password))
        {
            if (userName is null) return "Für ein Passwort wird ein Benutzername benötigt.";
            if (input.Password.Length < AuthEndpoints.MinPasswordLength)
                return $"Das Passwort muss mindestens {AuthEndpoints.MinPasswordLength} Zeichen lang sein.";
            employee.PasswordHash = hasher.HashPassword(employee, input.Password);
            employee.MustChangePassword = true;
        }

        if (userName is null) employee.PasswordHash = null;

        employee.Name = name;
        employee.SortOrder = input.SortOrder;
        employee.IsActive = input.IsActive;
        employee.ShowInPlan = input.ShowInPlan;
        employee.VacationDaysPerYear = input.VacationDaysPerYear;
        employee.Phone = string.IsNullOrWhiteSpace(input.Phone) ? null : input.Phone.Trim();
        employee.HourlyRate = input.HourlyRate is { } rate ? Math.Round(rate, 2) : null;
        employee.UserName = userName;
        employee.Role = input.Role;
        employee.MainActivity = input.MainActivity;
        // The main activity is not repeated among the additional ones; the order is that of the job.
        employee.AdditionalActivities = activities.Where(a => additional.Contains(a) && a != input.MainActivity).ToList();
        return null;
    }

    private static EmployeeDto ToDto(Employee e) => new(e.Id, e.Name, e.SortOrder, e.IsActive, e.ShowInPlan,
        e.VacationDaysPerYear, e.UserName, e.Role, e.PasswordHash is not null, e.MainActivity, e.AdditionalActivities,
        e.HourlyRate, e.Phone, e.DeletedAt is not null);
}
