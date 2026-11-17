using System.Security.Claims;

namespace Wego.Api.Endpoints;

/// <summary>
/// Whether something changed since a page loaded: every change saved through the API (any request but a read, and
/// not the login) moves a version on, with who made it. The pages ask for it every few seconds in the background and
/// load anew when it moved, so that a change by one planner shows with the others without reloading the page. Kept
/// in memory: after a restart the version is new, and the pages load once.
/// </summary>
public static class ChangeEndpoints
{
    public record ChangeDto(long Version, int ById, string? By);

    /// <summary><paramref name="Recent"/>: the last changes, oldest first; <paramref name="You"/>: who asks (his own changes are on his page already).</summary>
    public record ChangesDto(long Version, IReadOnlyList<ChangeDto> Recent, int You);

    private const int Kept = 100;
    private static readonly object Gate = new();
    // Milliseconds since 1970: new after a restart, and exact in JavaScript (unlike ticks).
    private static long version = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static readonly Queue<ChangeDto> Recent = new();

    public static ChangesDto For(ClaimsPrincipal user)
    {
        lock (Gate) return new(version, Recent.ToList(), user.EmployeeId());
    }

    public static void Moved(ClaimsPrincipal user)
    {
        lock (Gate)
        {
            version++;
            Recent.Enqueue(new(version, user.EmployeeId(), user.FindFirstValue(ClaimTypes.Name)));
            while (Recent.Count > Kept) Recent.Dequeue();
        }
    }

    /// <summary>After each request: a change that went through moves the version on.</summary>
    public static IApplicationBuilder UseChangeVersion(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        await next();
        var request = context.Request;
        if (HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method) || HttpMethods.IsOptions(request.Method)) return;
        if (!request.Path.StartsWithSegments("/api") || request.Path.StartsWithSegments("/api/auth")) return;
        if (context.Response.StatusCode >= 400) return;
        Moved(context.User);
    });

    public static void MapChangeEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/changes", (ClaimsPrincipal user) => Results.Ok(For(user))).RequireAuthorization();
    }
}
