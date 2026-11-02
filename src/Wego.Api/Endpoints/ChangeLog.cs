using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>
/// Writes who changed what and when into <see cref="WegoDbContext.ChangeLog"/>. The entries are added to the
/// context and saved with the change itself, so a change and its log entry are stored together or not at all.
/// There is no endpoint that reads the log.
/// </summary>
public static class ChangeLog
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public static string? ToJson(object? value) => value is null ? null : JsonSerializer.Serialize(value, Json);

    public static void Add(WegoDbContext db, ClaimsPrincipal user, ChangeArea area, string action, int? entityId,
        object? before, object? after, DateOnly? date = null)
    {
        var id = user.EmployeeId();
        db.ChangeLog.Add(new ChangeLogEntry
        {
            ChangedAt = DateTime.UtcNow,
            ChangedById = id == 0 ? null : id,
            ChangedBy = user.FindFirstValue(ClaimTypes.Name),
            Area = area,
            Action = action,
            EntityId = entityId,
            Date = date,
            Before = ToJson(before),
            After = ToJson(after),
        });
    }
}
