using System.Security.Claims;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;
using Wego.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();

builder.Services.AddDbContext<WegoDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Wego")));

builder.Services.AddSingleton<IPasswordHasher<Employee>, PasswordHasher<Employee>>();

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddHttpClient(SchoolHolidayEndpoints.OpenHolidaysClient, client =>
{
    client.BaseAddress = new Uri("https://openholidaysapi.org/");
    client.Timeout = TimeSpan.FromSeconds(15);
});
// School holidays of new years come by themselves; the tests do without the outside world.
if (!builder.Environment.IsEnvironment("Testing"))
    builder.Services.AddHostedService<HolidayImportService>();

builder.Services.AddHttpClient(NominatimGeocoder.Client, client =>
{
    client.BaseAddress = new Uri("https://nominatim.openstreetmap.org/");
    client.Timeout = TimeSpan.FromSeconds(10);
    // Nominatim asks every application to name itself.
    client.DefaultRequestHeaders.UserAgent.ParseAdd("WEGO-Personaleinsatzplanung/1.0");
});
builder.Services.AddSingleton<IGeocoder, NominatimGeocoder>();

builder.Services.AddHttpClient(PostalCodeEndpoints.OpenPlzClient, client =>
{
    client.BaseAddress = new Uri("https://openplzapi.org/");
    client.Timeout = TimeSpan.FromSeconds(10);
});

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "wego.auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.ExpireTimeSpan = TimeSpan.FromDays(14);
        options.SlidingExpiration = true;

        // The frontend is a single-page app: answer with status codes instead of redirects.
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };

        // A deactivated account or a changed role takes effect immediately, not when the cookie expires.
        options.Events.OnValidatePrincipal = async context =>
        {
            var db = context.HttpContext.RequestServices.GetRequiredService<WegoDbContext>();
            var id = context.Principal?.EmployeeId() ?? 0;
            var role = context.Principal?.FindFirstValue(ClaimTypes.Role);
            if (!await db.Employees.AnyAsync(e => e.Id == id && e.IsActive && e.Role == role))
                context.RejectPrincipal();
        };
    });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy(Policies.Plan, policy => policy.RequireRole(Roles.PlanerA, Roles.PlanerG))
    .AddPolicy(Policies.Admin, policy => policy.RequireRole(Roles.PlanerG))
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

// Sign-ins per minute and address; the tests sign in far more often than a person.
var loginsPerMinute = builder.Configuration.GetValue("RateLimit:LoginsPerMinute", 30);
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(AuthEndpoints.LoginRateLimit, context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = loginsPerMinute, Window = TimeSpan.FromMinutes(1) }));
});

// The keys encrypt the login cookie. On the server they lie on a volume, otherwise a new container
// would make new keys and every deploy would sign everybody out.
var keysPath = builder.Configuration["DataProtection:KeysPath"];
if (!string.IsNullOrEmpty(keysPath))
{
    builder.Services.AddDataProtection()
        .SetApplicationName("Wego")
        .PersistKeysToFileSystem(new DirectoryInfo(keysPath));
}

var app = builder.Build();

if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<WegoDbContext>().Database.MigrateAsync();
}

await DbSeeder.SeedFirstPlanerAsync(app);

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
}

app.UseHttpsRedirection();

// In the container the React build lies in wwwroot and is served from the same origin as the API,
// so the login cookie needs no CORS. Static files come before authorization: the login page is public.
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        // Vite puts a content hash into every file name under /assets; index.html must always be fetched fresh.
        context.Context.Response.Headers.CacheControl =
            context.Context.Request.Path.StartsWithSegments("/assets")
                ? "public, max-age=31536000, immutable"
                : "no-cache";
    },
});
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapAuthEndpoints();
app.MapPlanEndpoints();
app.MapSiteEndpoints();
app.MapOfferEndpoints();
app.MapReportEndpoints();
app.MapEmployeeEndpoints();
app.MapSchoolHolidayEndpoints();
app.MapActivityEndpoints();
app.MapPostalCodeEndpoints();
app.MapCalendarNoteEndpoints();
app.MapMyEndpoints();
app.MapLocationEndpoints();

app.Run();

public partial class Program;
