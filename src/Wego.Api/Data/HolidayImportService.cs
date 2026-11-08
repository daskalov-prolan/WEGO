using Microsoft.EntityFrameworkCore;
using Wego.Api.Endpoints;

namespace Wego.Api.Data;

/// <summary>
/// Fetches the Berlin school holidays (and public holidays) by itself: at the start and once a day, for every year
/// of the calendar (three back, five ahead) that has no school holidays yet. A year the API does not know yet is tried again
/// the next day. Only school holidays that begin in the year count: the Christmas holidays of the year before reach
/// into January and do not make the year loaded.
/// </summary>
public class HolidayImportService(IServiceScopeFactory scopes, IHttpClientFactory httpClients, ILogger<HolidayImportService> logger)
    : BackgroundService
{
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
        for (var year = DateTime.Today.Year - 3; year <= DateTime.Today.Year + 5 && !stoppingToken.IsCancellationRequested; year++)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<WegoDbContext>();
                var (from, to) = (new DateOnly(year, 1, 1), new DateOnly(year, 12, 31));
                if (await db.SchoolHolidays.AnyAsync(h => h.Kind == HolidayKind.Schulferien && h.StartDate >= from && h.StartDate <= to, stoppingToken))
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
