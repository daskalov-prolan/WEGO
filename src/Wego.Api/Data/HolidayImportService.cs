using Microsoft.EntityFrameworkCore;
using Wego.Api.Endpoints;

namespace Wego.Api.Data;

/// <summary>
/// Fetches the Berlin school holidays (and public holidays) by itself: at the start and once a day, for every year
/// from 2026 to two years ahead that has no school holidays yet. A year the API does not know yet is tried again
/// the next day.
/// </summary>
public class HolidayImportService(IServiceScopeFactory scopes, IHttpClientFactory httpClients, ILogger<HolidayImportService> logger)
    : BackgroundService
{
    private const int FirstYear = 2026;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await ImportMissingYearsAsync(stoppingToken);
            try
            {
                await Task.Delay(TimeSpan.FromDays(1), stoppingToken);
            }
            catch (TaskCanceledException)
            {
                return;
            }
        }
    }

    private async Task ImportMissingYearsAsync(CancellationToken stoppingToken)
    {
        for (var year = FirstYear; year <= DateTime.Today.Year + 2 && !stoppingToken.IsCancellationRequested; year++)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<WegoDbContext>();
                var (from, to) = (new DateOnly(year, 1, 1), new DateOnly(year, 12, 31));
                if (await db.SchoolHolidays.AnyAsync(h => h.Kind == HolidayKind.Schulferien && h.StartDate <= to && h.EndDate >= from, stoppingToken))
                    continue;
                var result = await SchoolHolidayEndpoints.ImportYearAsync(db,
                    httpClients.CreateClient(SchoolHolidayEndpoints.OpenHolidaysClient), year);
                logger.LogInformation("Holidays {Year}: {Imported} of {Total} taken over", year, result.Imported, result.Total);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning(ex, "Holiday import for {Year} failed", year);
            }
        }
    }
}
