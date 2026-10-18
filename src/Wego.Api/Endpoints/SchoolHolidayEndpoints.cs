using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;
using static Wego.Api.Endpoints.PlanEndpoints;

namespace Wego.Api.Endpoints;

public static class SchoolHolidayEndpoints
{
    public const string OpenHolidaysClient = "openholidays";

    public record SchoolHolidayInput(string Name, DateOnly StartDate, DateOnly EndDate,
        HolidayKind Kind = HolidayKind.Schulferien);
    public record ImportResult(int Imported, int Total);

    // Response format of https://openholidaysapi.org/SchoolHolidays and /PublicHolidays
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
            if (!Enum.IsDefined(input.Kind)) return ApiErrors.BadRequest("Unbekannte Art.");

            var holiday = new SchoolHoliday
            {
                Name = name, Kind = input.Kind, StartDate = input.StartDate, EndDate = input.EndDate,
            };
            db.SchoolHolidays.Add(holiday);
            await db.SaveChangesAsync();
            return Results.Ok(new SchoolHolidayDto(holiday.Id, holiday.Name, holiday.Kind, holiday.StartDate,
                holiday.EndDate));
        });

        group.MapDelete("/{id:int}", async (int id, WegoDbContext db) =>
        {
            var deleted = await db.SchoolHolidays.Where(h => h.Id == id).ExecuteDeleteAsync();
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        });

        // Loads the Berlin school holidays and public holidays of one year from the public OpenHolidays API.
        group.MapPost("/import", async (int year, WegoDbContext db, IHttpClientFactory httpClientFactory,
            ILoggerFactory loggerFactory) =>
        {
            var client = httpClientFactory.CreateClient(OpenHolidaysClient);
            var query = $"?countryIsoCode=DE&subdivisionCode=DE-BE&languageIsoCode=DE&validFrom={year}-01-01&validTo={year}-12-31";
            var fetched = new List<(HolidayKind Kind, OpenHoliday Holiday)>();
            try
            {
                foreach (var (kind, path) in new[] { (HolidayKind.Schulferien, "SchoolHolidays"), (HolidayKind.Feiertag, "PublicHolidays") })
                {
                    var holidays = await client.GetFromJsonAsync<List<OpenHoliday>>(path + query) ?? [];
                    fetched.AddRange(holidays.Select(holiday => (kind, holiday)));
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
            {
                loggerFactory.CreateLogger(nameof(SchoolHolidayEndpoints))
                    .LogWarning(ex, "Holiday import for {Year} failed", year);
                return Results.Problem("Die Ferien und Feiertage konnten nicht abgerufen werden.",
                    statusCode: StatusCodes.Status502BadGateway);
            }

            var (from, to) = YearRange(year);
            var existing = await db.SchoolHolidays
                .Where(h => h.StartDate <= to && h.EndDate >= from)
                .ToListAsync();

            var imported = 0;
            foreach (var (kind, holiday) in fetched)
            {
                if (existing.Any(h => h.Kind == kind && h.StartDate == holiday.StartDate && h.EndDate == holiday.EndDate))
                    continue;

                db.SchoolHolidays.Add(new SchoolHoliday
                {
                    Name = holiday.Name?.FirstOrDefault()?.Text ?? kind.ToString(),
                    Kind = kind,
                    StartDate = holiday.StartDate,
                    EndDate = holiday.EndDate,
                });
                imported++;
            }

            await db.SaveChangesAsync();
            return Results.Ok(new ImportResult(imported, fetched.Count));
        });    }
}
