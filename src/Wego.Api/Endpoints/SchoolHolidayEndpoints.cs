using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;
using static Wego.Api.Endpoints.PlanEndpoints;

namespace Wego.Api.Endpoints;

public static class SchoolHolidayEndpoints
{
    public const string OpenHolidaysClient = "openholidays";

    public record SchoolHolidayInput(string Name, DateOnly StartDate, DateOnly EndDate);
    public record ImportResult(int Imported, int Total);

    // Response format of https://openholidaysapi.org/SchoolHolidays
    private record OpenHoliday(DateOnly StartDate, DateOnly EndDate, List<OpenHolidayName>? Name);
    private record OpenHolidayName(string Language, string Text);

    public static void MapSchoolHolidayEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/schoolholidays").RequireAuthorization(Roles.Planer);

        group.MapPost("/", async (SchoolHolidayInput input, WegoDbContext db) =>
        {
            var name = input.Name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > 200)
                return ApiErrors.BadRequest("Bitte eine Bezeichnung mit höchstens 200 Zeichen angeben.");
            if (input.EndDate < input.StartDate)
                return ApiErrors.BadRequest("Das Ende darf nicht vor dem Beginn liegen.");

            var holiday = new SchoolHoliday { Name = name, StartDate = input.StartDate, EndDate = input.EndDate };
            db.SchoolHolidays.Add(holiday);
            await db.SaveChangesAsync();
            return Results.Ok(new SchoolHolidayDto(holiday.Id, holiday.Name, holiday.StartDate, holiday.EndDate));
        });

        group.MapDelete("/{id:int}", async (int id, WegoDbContext db) =>
        {
            var deleted = await db.SchoolHolidays.Where(h => h.Id == id).ExecuteDeleteAsync();
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        });

        // Loads the Berlin school holidays of one year from the public OpenHolidays API.
        group.MapPost("/import", async (int year, WegoDbContext db, IHttpClientFactory httpClientFactory,
            ILoggerFactory loggerFactory) =>
        {
            List<OpenHoliday>? holidays;
            try
            {
                holidays = await httpClientFactory.CreateClient(OpenHolidaysClient).GetFromJsonAsync<List<OpenHoliday>>(
                    $"SchoolHolidays?countryIsoCode=DE&subdivisionCode=DE-BE&languageIsoCode=DE" +
                    $"&validFrom={year}-01-01&validTo={year}-12-31");
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
            {
                loggerFactory.CreateLogger(nameof(SchoolHolidayEndpoints))
                    .LogWarning(ex, "School holiday import for {Year} failed", year);
                return Results.Problem("Die Schulferien konnten nicht abgerufen werden.",
                    statusCode: StatusCodes.Status502BadGateway);
            }

            holidays ??= [];
            var (from, to) = YearRange(year);
            var existing = await db.SchoolHolidays
                .Where(h => h.StartDate <= to && h.EndDate >= from)
                .ToListAsync();

            var imported = 0;
            foreach (var holiday in holidays)
            {
                if (existing.Any(h => h.StartDate == holiday.StartDate && h.EndDate == holiday.EndDate)) continue;

                db.SchoolHolidays.Add(new SchoolHoliday
                {
                    Name = holiday.Name?.FirstOrDefault()?.Text ?? "Schulferien",
                    StartDate = holiday.StartDate,
                    EndDate = holiday.EndDate,
                });
                imported++;
            }

            await db.SaveChangesAsync();
            return Results.Ok(new ImportResult(imported, holidays.Count));
        });
    }
}
