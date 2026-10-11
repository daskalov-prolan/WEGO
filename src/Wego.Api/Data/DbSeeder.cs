using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Wego.Api.Data;

public static class DbSeeder
{
    /// <summary>
    /// Creates the first planner from the configuration (Seed:PlanerUserName / Seed:PlanerPassword)
    /// as long as nobody can sign in yet. All further accounts are created in the application.
    /// </summary>
    public static async Task SeedFirstPlanerAsync(WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WegoDbContext>();
        if (await db.Employees.AnyAsync(e => e.UserName != null)) return;

        var userName = app.Configuration["Seed:PlanerUserName"]?.Trim().ToLowerInvariant();
        var password = app.Configuration["Seed:PlanerPassword"];
        if (string.IsNullOrEmpty(userName) || string.IsNullOrEmpty(password))
        {
            app.Logger.LogWarning(
                "No account exists and Seed:PlanerUserName / Seed:PlanerPassword are not configured: nobody can sign in.");
            return;
        }

        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<Employee>>();
        var planer = new Employee
        {
            Name = app.Configuration["Seed:PlanerName"] ?? "Planer",
            UserName = userName,
            Role = Roles.Planer,
            ShowInPlan = false,
        };
        planer.PasswordHash = hasher.HashPassword(planer, password);
        db.Employees.Add(planer);
        await db.SaveChangesAsync();
    }
}
