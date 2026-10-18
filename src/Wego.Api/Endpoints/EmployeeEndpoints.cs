using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

public static class EmployeeEndpoints
{
    public record EmployeeListItem(int Id, string Name);
    public record EmployeeDto(int Id, string Name, int SortOrder, bool IsActive, bool ShowInPlan,
        int VacationDaysPerYear, string? UserName, string Role, bool HasPassword, Activity? MainActivity,
        IReadOnlyList<Activity> AdditionalActivities);

    /// <summary>Password is only changed when it is not empty.</summary>
    /// <summary>The initial password is returned once and stored only as a hash.</summary>
    public record AccessDto(int EmployeeId, string Name, string UserName, string InitialPassword);

    public record EmployeeInput(string Name, int SortOrder, bool IsActive, bool ShowInPlan, int VacationDaysPerYear,
        string? UserName, string Role, string? Password, Activity? MainActivity = null,
        Activity[]? AdditionalActivities = null);

    public static void MapEmployeeEndpoints(this IEndpointRouteBuilder app)
    {
        // Names only, for the selection in the employee report.
        app.MapGet("/api/employees/names", async (WegoDbContext db) =>
            await db.Employees
                .Where(e => e.ShowInPlan)
                .OrderBy(e => e.SortOrder).ThenBy(e => e.Name)
                .Select(e => new EmployeeListItem(e.Id, e.Name))
                .ToListAsync()).RequireAuthorization(Roles.Planer);

        var group = app.MapGroup("/api/employees").RequireAuthorization(Roles.Planer);

        group.MapGet("/", async (WegoDbContext db) =>
            (await db.Employees.OrderBy(e => e.SortOrder).ThenBy(e => e.Name).ToListAsync()).Select(ToDto));

        group.MapPost("/", async (EmployeeInput input, WegoDbContext db, IPasswordHasher<Employee> hasher) =>
        {
            var employee = new Employee { Name = "" };
            var error = await Apply(employee, input, db, hasher);
            if (error is not null) return ApiErrors.BadRequest(error);

            db.Employees.Add(employee);
            await db.SaveChangesAsync();
            return Results.Created($"/api/employees/{employee.Id}", ToDto(employee));
        });

        group.MapPut("/{id:int}", async (int id, EmployeeInput input, WegoDbContext db,
            IPasswordHasher<Employee> hasher) =>
        {
            var employee = await db.Employees.FindAsync(id);
            if (employee is null) return Results.NotFound();

            var error = await Apply(employee, input, db, hasher);
            if (error is not null) return ApiErrors.BadRequest(error);

            // Nobody must be able to lock everyone out of the planning rights.
            var otherPlaners = await db.Employees.AnyAsync(e =>
                e.Id != id && e.IsActive && e.Role == Roles.Planer && e.UserName != null && e.PasswordHash != null);
            if (!otherPlaners && !CanPlan(employee))
                return ApiErrors.BadRequest("Es muss mindestens ein aktiver Planer mit Anmeldung übrig bleiben.");

            await db.SaveChangesAsync();
            return Results.Ok(ToDto(employee));
        });

        // Creates the login of an employee (user name from the name) or resets a forgotten password.
        // The employee has to choose their own password at the first sign-in.
        group.MapPost("/{id:int}/access", async (int id, WegoDbContext db, IPasswordHasher<Employee> hasher) =>
        {
            var employee = await db.Employees.FindAsync(id);
            if (employee is null) return Results.NotFound();
            if (!employee.IsActive) return ApiErrors.BadRequest("Für inaktive Mitarbeiter gibt es keinen Zugang.");

            employee.UserName ??= await UniqueUserName(db, employee.Name);
            var password = NewInitialPassword();
            employee.PasswordHash = hasher.HashPassword(employee, password);
            employee.MustChangePassword = true;
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

    private static bool CanPlan(Employee e) =>
        e.IsActive && e.Role == Roles.Planer && e.UserName is not null && e.PasswordHash is not null;

    private static async Task<string?> Apply(Employee employee, EmployeeInput input, WegoDbContext db,
        IPasswordHasher<Employee> hasher)
    {
        var name = input.Name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > 200)
            return "Bitte einen Namen mit höchstens 200 Zeichen angeben.";
        if (input.Role is not (Roles.Planer or Roles.Mitarbeiter)) return "Unbekannte Rolle.";
        if (input.VacationDaysPerYear is < 0 or > 366) return "Bitte gültige Urlaubstage pro Jahr angeben.";
        var additional = input.AdditionalActivities ?? [];
        if (input.MainActivity is { } main && !Enum.IsDefined(main) || additional.Any(a => !Enum.IsDefined(a)))
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
        employee.UserName = userName;
        employee.Role = input.Role;
        employee.MainActivity = input.MainActivity;
        // The main activity is not repeated among the additional ones; the order is that of the job.
        employee.AdditionalActivities = additional.Distinct().Where(a => a != input.MainActivity).Order().ToList();
        return null;
    }

    private static EmployeeDto ToDto(Employee e) => new(e.Id, e.Name, e.SortOrder, e.IsActive, e.ShowInPlan,
        e.VacationDaysPerYear, e.UserName, e.Role, e.PasswordHash is not null, e.MainActivity, e.AdditionalActivities);
}
