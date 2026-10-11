using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

public static class AuthEndpoints
{
    public const string LoginRateLimit = "login";
    public const int MinPasswordLength = 8;

    public record LoginRequest(string UserName, string Password);
    public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
    public record UserDto(int Id, string Name, string UserName, string Role, bool ShowInPlan,
        bool MustChangePassword);

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapPost("/login", async (LoginRequest request, WegoDbContext db,
            IPasswordHasher<Employee> hasher, HttpContext http) =>
        {
            var userName = NormalizeUserName(request.UserName);
            var employee = userName is null
                ? null
                : await db.Employees.SingleOrDefaultAsync(e => e.UserName == userName && e.IsActive);

            if (employee?.PasswordHash is null ||
                hasher.VerifyHashedPassword(employee, employee.PasswordHash, request.Password ?? "")
                    == PasswordVerificationResult.Failed)
            {
                return Results.Unauthorized();
            }

            var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, employee.Id.ToString()),
                new Claim(ClaimTypes.Name, employee.Name),
                new Claim(ClaimTypes.Role, employee.Role),
            ], CookieAuthenticationDefaults.AuthenticationScheme);

            await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
                new ClaimsPrincipal(identity), new AuthenticationProperties { IsPersistent = true });

            return Results.Ok(ToDto(employee));
        }).AllowAnonymous().RequireRateLimiting(LoginRateLimit);

        group.MapPost("/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        }).AllowAnonymous();

        group.MapGet("/me", async (ClaimsPrincipal user, WegoDbContext db) =>
        {
            var employee = await db.Employees.FindAsync(user.EmployeeId());
            return employee is null ? Results.Unauthorized() : Results.Ok(ToDto(employee));
        });

        group.MapPost("/password", async (ChangePasswordRequest request, ClaimsPrincipal user,
            WegoDbContext db, IPasswordHasher<Employee> hasher) =>
        {
            var employee = await db.Employees.FindAsync(user.EmployeeId());
            if (employee?.PasswordHash is null) return Results.Unauthorized();

            if (hasher.VerifyHashedPassword(employee, employee.PasswordHash, request.CurrentPassword ?? "")
                == PasswordVerificationResult.Failed)
            {
                return ApiErrors.BadRequest("Das aktuelle Passwort ist nicht korrekt.");
            }

            if ((request.NewPassword ?? "").Length < MinPasswordLength)
                return ApiErrors.BadRequest($"Das neue Passwort muss mindestens {MinPasswordLength} Zeichen lang sein.");

            if (request.NewPassword == request.CurrentPassword)
                return ApiErrors.BadRequest("Das neue Passwort muss sich vom aktuellen unterscheiden.");

            employee.PasswordHash = hasher.HashPassword(employee, request.NewPassword!);
            employee.MustChangePassword = false;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    public static string? NormalizeUserName(string? userName)
    {
        var trimmed = userName?.Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    public static int EmployeeId(this ClaimsPrincipal user) =>
        int.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0;

    public static bool IsPlaner(this ClaimsPrincipal user) => user.IsInRole(Roles.Planer);

    private static UserDto ToDto(Employee e) =>
        new(e.Id, e.Name, e.UserName ?? "", e.Role, e.ShowInPlan, e.MustChangePassword);
}

public static class ApiErrors
{
    public static IResult BadRequest(string message) => Results.BadRequest(new { message });
}
