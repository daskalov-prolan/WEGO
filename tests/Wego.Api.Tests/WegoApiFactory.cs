using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wego.Api.Data;
using Wego.Api.Endpoints;

namespace Wego.Api.Tests;

/// <summary>
/// Runs the API against its own database "wego_test" on the PostgreSQL from docker-compose.yml.
/// The database is dropped and migrated again for every test run.
/// </summary>
public class WegoApiFactory : WebApplicationFactory<Program>
{
    public const string PlanerUserName = "planer";
    public const string PlanerPassword = "test-planer-pw";

    private static readonly string ConnectionString =
        Environment.GetEnvironmentVariable("WEGO_TEST_CONNECTION")
        ?? "Host=localhost;Port=5432;Database=wego_test;Username=wego;Password=wego_dev";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        var options = new DbContextOptionsBuilder<WegoDbContext>().UseNpgsql(ConnectionString).Options;
        using (var db = new WegoDbContext(options))
        {
            db.Database.EnsureDeleted();
        }

        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Wego", ConnectionString);
        builder.UseSetting("Database:MigrateOnStartup", "true");
        builder.UseSetting("Seed:PlanerUserName", PlanerUserName);
        builder.UseSetting("Seed:PlanerPassword", PlanerPassword);
        builder.UseSetting("RateLimit:LoginsPerMinute", "1000");
        // No addresses go to OpenStreetMap from the tests.
        builder.ConfigureTestServices(services => services.AddSingleton<IGeocoder, FakeGeocoder>());
    }
}

/// <summary>Finds every address in Berlin-Mitte, except streets called "Nirgendwo".</summary>
public class FakeGeocoder : IGeocoder
{
    public int Calls;

    public Task<(double Latitude, double Longitude)?> LocateAsync(string street, string? postalCode, string? city)
    {
        Interlocked.Increment(ref Calls);
        return Task.FromResult<(double, double)?>(street.StartsWith("Nirgendwo") ? null : (52.52, 13.405));
    }
}
