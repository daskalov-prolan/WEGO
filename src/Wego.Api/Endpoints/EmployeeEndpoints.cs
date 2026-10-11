using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

public static class EmployeeEndpoints
{
    public record EmployeeListItem(int Id, string Name);
    public record EmployeeDto(int Id, string Name, int SortOrder, bool IsActive, bool ShowInPlan,
        int VacationDaysPerYear, string? UserName, string Role, bool HasPassword);

    /// <summary>Password is only changed when it is not empty.</summary>
    public record EmployeeInput(string Name, int SortOrder, bool IsActive, bool ShowInPlan, int VacationDaysPerYear,
        string? UserName, string Role, string? Password);

    public static void MapEmployeeEndpoints(this IEndpointRouteBuilder app)
    {
        // Names only, for every signed-in user (report selection).
        app.MapGet("/api/employees/names", async (WegoDbContext db) =>
            await db.Employees
                .Where(e => e.ShowInPlan)
                .OrderBy(e => e.SortOrder).ThenBy(e => e.Name)
                .Select(e => new EmployeeListItem(e.Id, e.Name))
                .ToListAsync());

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
    }

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
        }

        if (userName is null) employee.PasswordHash = null;

        employee.Name = name;
        employee.SortOrder = input.SortOrder;
        employee.IsActive = input.IsActive;
        employee.ShowInPlan = input.ShowInPlan;
        employee.VacationDaysPerYear = input.VacationDaysPerYear;
        employee.UserName = userName;
        employee.Role = input.Role;
        return null;
    }

    private static EmployeeDto ToDto(Employee e) => new(e.Id, e.Name, e.SortOrder, e.IsActive, e.ShowInPlan,
        e.VacationDaysPerYear, e.UserName, e.Role, e.PasswordHash is not null);
}
