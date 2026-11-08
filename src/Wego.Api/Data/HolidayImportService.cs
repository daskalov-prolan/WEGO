using Microsoft.EntityFrameworkCore;
using Wego.Api.Endpoints;

namespace Wego.Api.Data;

/// <summary>
/// Fetches the Berlin school holidays (and public holidays) by itself: at the start and once a day, for every year
/// of the calendar (three back, five ahead) that does not have all its school holidays yet. A year the API does not know
/// yet is tried again the next day. A year counts as loaded with all its school holidays (Berlin has six or more a year): the Christmas
/// holidays of a year alone, taken over with the year after, or a year only partly known yet, are fetched again.
/// What is there already is not taken twice.
/// </summary>
public class HolidayImportService(IServiceScopeFactory scopes, IHttpClientFactory httpClients, ILogger<HolidayImportService> logger)
    : BackgroundService
{
    /// <summary>School holidays of a whole year in Berlin: winter, Easter, Pentecost, summer, autumn, Christmas.</summary>
    private const int FullYear = 6;

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
                if (await db.SchoolHolidays.CountAsync(h => h.Kind == HolidayKind.Schulferien && h.StartDate >= from && h.StartDate <= to, stoppingToken) >= FullYear)
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
