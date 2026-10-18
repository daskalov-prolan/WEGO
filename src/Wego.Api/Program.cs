using System.Security.Claims;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
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
    .AddPolicy(Roles.Planer, policy => policy.RequireRole(Roles.Planer))
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(AuthEndpoints.LoginRateLimit, context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1) }));
});

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
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapAuthEndpoints();
app.MapPlanEndpoints();
app.MapSiteEndpoints();
app.MapReportEndpoints();
app.MapEmployeeEndpoints();
app.MapSchoolHolidayEndpoints();

app.Run();

public partial class Program;
