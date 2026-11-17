using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Ical.Net.CalendarComponents;
using Ical.Net.DataTypes;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>
/// The plan and the calendars of the employees (e.g. Apple's) side by side. Each employee has a secret link to his
/// own appointments, for his calendar to subscribe to (read only: changed here, in the plan). And a calendar of his
/// own can be shared with the plan: its appointments are shown as "belegt", only the times, nothing of what they are.
/// </summary>
public static class CalendarEndpoints
{
    public const string Client = "external-calendar";

    /// <summary>How far back and ahead appointments go into the link, and busy times are read.</summary>
    private const int DaysBack = 60, DaysAhead = 365, BusyAhead = 180;

    /// <summary>Calendars read only from these hosts (and only by https): no other address is asked by the server.</summary>
    private static readonly string[] Hosts = ["icloud.com", "calendar.google.com", "outlook.office365.com", "outlook.live.com"];

    private static readonly TimeZoneInfo Berlin = BerlinZone();

    /// <summary>Berlin; without the time zones on the server its own zone (the app starts all the same).</summary>
    private static TimeZoneInfo BerlinZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Europe/Berlin");
        }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return TimeZoneInfo.Local;
        }
    }

    public record MyCalendarDto(string? Link, string? ExternalUrl, DateTime? SyncedAt, string? Error, int Busy);
    public record ExternalInput(string? Url);
    public record BusyDto(int EmployeeId, DateOnly Date, TimeOnly? StartTime, TimeOnly? EndTime);

    public static void MapCalendarEndpoints(this IEndpointRouteBuilder app)
    {
        // His own appointments, for Apple, Google or Outlook: the link is the key, no login.
        app.MapGet("/api/calendar/{token}.ics", async (string token, WegoDbContext db) =>
        {
            if (token.Length < 20) return Results.NotFound();
            var employee = await db.Employees.AsNoTracking().FirstOrDefaultAsync(e => e.CalendarToken == token && e.IsActive && e.DeletedAt == null);
            if (employee is null) return Results.NotFound();
            return Results.Text(await IcsAsync(db, employee), "text/calendar; charset=utf-8");
        }).AllowAnonymous();

        var me = app.MapGroup("/api/me/calendar").RequireAuthorization();

        me.MapGet("/", async (ClaimsPrincipal user, HttpRequest request, WegoDbContext db) =>
        {
            var employee = await db.Employees.FirstOrDefaultAsync(e => e.Id == user.EmployeeId());
            if (employee is null) return Results.NotFound();
            return Results.Ok(await DtoAsync(db, employee, request));
        });

        // The link made (or made anew: the old one no longer works, e.g. when it went to somebody else).
        me.MapPost("/link", async (bool? renew, ClaimsPrincipal user, HttpRequest request, WegoDbContext db) =>
        {
            var employee = await db.Employees.FirstOrDefaultAsync(e => e.Id == user.EmployeeId());
            if (employee is null) return Results.NotFound();
            if (employee.CalendarToken is null || renew == true)
            {
                employee.CalendarToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)).Replace('+', '-').Replace('/', '_');
                await db.SaveChangesAsync();
            }
            return Results.Ok(await DtoAsync(db, employee, request));
        });

        // His own calendar shared with the plan (or no longer: url empty); read at once.
        me.MapPut("/external", async (ExternalInput input, ClaimsPrincipal user, HttpRequest request, WegoDbContext db, IHttpClientFactory http) =>
        {
            var employee = await db.Employees.FirstOrDefaultAsync(e => e.Id == user.EmployeeId());
            if (employee is null) return Results.NotFound();
            var url = input.Url?.Trim();
            if (string.IsNullOrEmpty(url))
            {
                employee.ExternalCalendarUrl = null;
                employee.ExternalCalendarSyncedAt = null;
                employee.ExternalCalendarError = null;
                await db.ExternalBusy.Where(b => b.EmployeeId == employee.Id).ExecuteDeleteAsync();
                await db.SaveChangesAsync();
                return Results.Ok(await DtoAsync(db, employee, request));
            }
            if (Normalize(url) is null)
                return ApiErrors.BadRequest("Bitte den Link eines freigegebenen Kalenders von Apple (iCloud), Google oder Outlook einfügen.");
            employee.ExternalCalendarUrl = url;
            await SyncAsync(db, http, employee);
            return Results.Ok(await DtoAsync(db, employee, request));
        });
    }

    private static async Task<MyCalendarDto> DtoAsync(WegoDbContext db, Employee employee, HttpRequest request) => new(
        employee.CalendarToken is { } token ? $"{request.Scheme}://{request.Host}/api/calendar/{token}.ics" : null,
        employee.ExternalCalendarUrl, employee.ExternalCalendarSyncedAt, employee.ExternalCalendarError,
        await db.ExternalBusy.CountAsync(b => b.EmployeeId == employee.Id));

    /// <summary>webcal:// as https://; null for anything but https to one of <see cref="Hosts"/>.</summary>
    public static Uri? Normalize(string url)
    {
        if (url.StartsWith("webcal://", StringComparison.OrdinalIgnoreCase)) url = "https://" + url["webcal://".Length..];
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps) return null;
        var host = uri.Host.ToLowerInvariant();
        return Hosts.Any(h => host == h || host.EndsWith("." + h)) ? uri : null;
    }

    // ---- The busy times of the own calendars ----

    /// <summary>The busy times of the employees shown, from..to: a planner sees all, anybody else his own.</summary>
    public static async Task<List<BusyDto>> BusyAsync(WegoDbContext db, ClaimsPrincipal user, DateOnly from, DateOnly to, int? employeeId = null)
    {
        var mine = user.EmployeeId();
        var query = db.ExternalBusy.AsNoTracking().Where(b => b.Date >= from && b.Date <= to);
        if (!user.CanPlan()) query = query.Where(b => b.EmployeeId == mine);
        if (employeeId is { } id) query = query.Where(b => b.EmployeeId == id);
        return (await query.OrderBy(b => b.Date).ThenBy(b => b.StartTime).ToListAsync())
            .Select(b => new BusyDto(b.EmployeeId, b.Date, b.StartTime, b.EndTime)).ToList();
    }

    /// <summary>
    /// Reads the own calendar of the employee and keeps its times from yesterday on (each day apart; the whole day
    /// without times). What could not be read is kept as the error, the times read before stay.
    /// </summary>
    public static async Task SyncAsync(WegoDbContext db, IHttpClientFactory http, Employee employee, CancellationToken cancel = default)
    {
        var uri = employee.ExternalCalendarUrl is { } url ? Normalize(url) : null;
        if (uri is null) return;
        try
        {
            using var response = await http.CreateClient(Client).GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancel);
            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException(response.StatusCode == System.Net.HttpStatusCode.NotFound
                    ? "Den Kalender gibt es unter diesem Link nicht (mehr). Ist er noch freigegeben?"
                    : $"Der Kalender antwortet nicht ({(int)response.StatusCode}).");
            if (response.Content.Headers.ContentLength > 5_000_000) throw new InvalidOperationException("Der Kalender ist zu groß.");
            var text = await response.Content.ReadAsStringAsync(cancel);
            var busy = Parse(text, Today.AddDays(-1), Today.AddDays(BusyAhead));
            await db.ExternalBusy.Where(b => b.EmployeeId == employee.Id).ExecuteDeleteAsync(cancel);
            db.ExternalBusy.AddRange(busy.Select(b => new ExternalBusy { EmployeeId = employee.Id, Date = b.Date, StartTime = b.Start, EndTime = b.End }));
            employee.ExternalCalendarError = null;
            employee.ExternalCalendarSyncedAt = DateTime.UtcNow;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or InvalidOperationException or FormatException or ArgumentException)
        {
            employee.ExternalCalendarError = e is InvalidOperationException ? e.Message : "Der Kalender konnte nicht gelesen werden.";
        }
        await db.SaveChangesAsync(cancel);
    }

    /// <summary>The times of the appointments of a calendar (iCalendar) from..to in Berlin, a day at a time.</summary>
    public static List<(DateOnly Date, TimeOnly? Start, TimeOnly? End)> Parse(string ics, DateOnly from, DateOnly to)
    {
        var calendar = Ical.Net.Calendar.Load(ics) ?? throw new FormatException();
        var start = new CalDateTime(from.Year, from.Month, from.Day, 0, 0, 0, "Europe/Berlin");
        var end = to.AddDays(1).ToDateTime(TimeOnly.MinValue);
        var result = new List<(DateOnly, TimeOnly?, TimeOnly?)>();
        foreach (var occurrence in calendar.GetOccurrences<CalendarEvent>(start))
        {
            if (occurrence.Source is CalendarEvent { Transparency: "TRANSPARENT" }) continue;
            var period = occurrence.Period;
            var first = period.StartTime;
            if (first.AsUtc > TimeZoneInfo.ConvertTimeToUtc(end, Berlin)) break;
            if (!first.HasTime)
            {
                // A whole day (or days): until the day before its end.
                var lastDay = period.EffectiveEndTime is { } e ? DateOnly.FromDateTime(e.Value).AddDays(-1) : DateOnly.FromDateTime(first.Value);
                for (var d = DateOnly.FromDateTime(first.Value); d <= lastDay; d = d.AddDays(1))
                    if (d >= from && d <= to) result.Add((d, null, null));
                continue;
            }
            var from0 = TimeZoneInfo.ConvertTimeFromUtc(first.AsUtc, Berlin);
            var to0 = period.EffectiveEndTime is { } last ? TimeZoneInfo.ConvertTimeFromUtc(last.AsUtc, Berlin) : from0;
            for (var d = DateOnly.FromDateTime(from0); d <= DateOnly.FromDateTime(to0) && d <= to; d = d.AddDays(1))
            {
                if (d < from) continue;
                var s = d == DateOnly.FromDateTime(from0) ? TimeOnly.FromDateTime(from0) : TimeOnly.MinValue;
                var e = d == DateOnly.FromDateTime(to0) ? TimeOnly.FromDateTime(to0) : new TimeOnly(23, 59);
                if (e > s) result.Add((d, s, e));
            }
        }
        return result;
    }

    // ---- The link: his appointments as iCalendar ----

    private static async Task<string> IcsAsync(WegoDbContext db, Employee employee)
    {
        var from = Today.AddDays(-DaysBack);
        var to = Today.AddDays(DaysAhead);
        var labels = await db.Activities.AsNoTracking().ToDictionaryAsync(a => a.Key, a => a.Label);
        var entries = await db.PlanEntries.AsNoTracking().Include(e => e.Site)
            .Where(e => e.EmployeeId == employee.Id && e.Date >= from && e.Date <= to)
            .OrderBy(e => e.Date).ThenBy(e => e.StartTime).ToListAsync();
        var meetings = await MeetingEndpoints.OccurrencesAsync(db, from, to, employee.Id);

        var ics = new StringBuilder();
        void Line(string text)
        {
            // Lines of at most 75 octets, folded with a space.
            var bytes = Encoding.UTF8.GetBytes(text);
            var at = 0;
            var first = true;
            while (at < bytes.Length)
            {
                var size = Math.Min(first ? 75 : 74, bytes.Length - at);
                while (size > 0 && at + size < bytes.Length && (bytes[at + size] & 0xC0) == 0x80) size--;
                ics.Append(first ? "" : " ").Append(Encoding.UTF8.GetString(bytes, at, size)).Append("\r\n");
                at += size;
                first = false;
            }
        }
        static string Esc(string text) => text.Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,").Replace("\r\n", "\\n").Replace("\n", "\\n");
        static string Local(DateOnly d, TimeOnly t) => d.ToDateTime(t).ToString("yyyyMMdd'T'HHmmss", CultureInfo.InvariantCulture);
        var stamp = DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);

        void Event(string uid, string summary, DateOnly date, TimeOnly? start, TimeOnly? end, string? location, string? description)
        {
            Line("BEGIN:VEVENT");
            Line($"UID:{uid}@wego-badcenter.de");
            Line($"DTSTAMP:{stamp}");
            if (start is { } s && end is { } e)
            {
                Line($"DTSTART;TZID=Europe/Berlin:{Local(date, s)}");
                Line($"DTEND;TZID=Europe/Berlin:{Local(date, e)}");
            }
            else
            {
                Line($"DTSTART;VALUE=DATE:{date:yyyyMMdd}");
                Line($"DTEND;VALUE=DATE:{date.AddDays(1):yyyyMMdd}");
            }
            Line($"SUMMARY:{Esc(summary)}");
            if (!string.IsNullOrWhiteSpace(location)) Line($"LOCATION:{Esc(location)}");
            if (!string.IsNullOrWhiteSpace(description)) Line($"DESCRIPTION:{Esc(description)}");
            Line("END:VEVENT");
        }

        Line("BEGIN:VCALENDAR");
        Line("VERSION:2.0");
        Line("PRODID:-//WEGO Badcenter//Personaleinsatzplanung//DE");
        Line("CALSCALE:GREGORIAN");
        Line("METHOD:PUBLISH");
        Line($"X-WR-CALNAME:{Esc("WEGO · " + employee.Name)}");
        Line("X-WR-TIMEZONE:Europe/Berlin");
        // Apple asks again after this time (it may wait longer).
        Line("REFRESH-INTERVAL;VALUE=DURATION:PT15M");
        Line("X-PUBLISHED-TTL:PT15M");
        foreach (var tz in new[]
        {
            "BEGIN:VTIMEZONE", "TZID:Europe/Berlin",
            "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
            "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
            "END:VTIMEZONE",
        }) Line(tz);

        foreach (var e in entries)
        {
            if (OfferEndpoints.IsFree(e)) continue;
            string summary;
            string? location = null;
            if (e.Type != EntryType.Baustelle) summary = e.Type.ToString();
            else if (e.Site is { } site)
            {
                var label = e.Activity is { } a && labels.TryGetValue(a, out var l) ? l : null;
                var customer = string.IsNullOrWhiteSpace(site.Salutation) ? site.Name : $"{site.Salutation} {site.Name}";
                summary = label is null ? site.Name : site.Status == SiteStatus.Angebot ? $"{label} · {customer}" : $"{site.Name} · {label}";
                location = string.Join(", ", new[]
                {
                    string.Join(' ', new[] { site.Street, site.HouseNumber }.Where(x => !string.IsNullOrWhiteSpace(x))),
                    string.Join(' ', new[] { site.PostalCode, site.City }.Where(x => !string.IsNullOrWhiteSpace(x))),
                }.Where(x => x.Length > 0));
            }
            else if (e.Activity is { } a && labels.TryGetValue(a, out var l)) summary = e.Activity == VisitEndpoints.Activity ? "Besichtigungstag" : l;
            else continue;
            Event($"entry-{e.Id}", summary, e.Date, e.StartTime, e.EndTime, location, e.Note);
        }
        foreach (var m in meetings)
            Event($"meeting-{m.MeetingId}-{m.OriginalDate:yyyyMMdd}", m.Title, m.Date, m.StartTime, m.EndTime, null, null);

        Line("END:VCALENDAR");
        return ics.ToString();
    }

    private static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Berlin));
}

/// <summary>Reads the own calendars of the employees every 15 minutes.</summary>
public class ExternalCalendarSync(IServiceScopeFactory scopes, IHttpClientFactory http, ILogger<ExternalCalendarSync> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<WegoDbContext>();
                var employees = await db.Employees.Where(e => e.ExternalCalendarUrl != null && e.IsActive && e.DeletedAt == null).ToListAsync(stoppingToken);
                foreach (var employee in employees) await CalendarEndpoints.SyncAsync(db, http, employee, stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Reading the own calendars failed");
            }
            try
            {
                await Task.Delay(TimeSpan.FromMinutes(15), stoppingToken);
            }
            catch (TaskCanceledException)
            {
                return;
            }
        }
    }
}
