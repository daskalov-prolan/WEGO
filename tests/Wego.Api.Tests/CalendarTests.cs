using Wego.Api.Endpoints;

namespace Wego.Api.Tests;

/// <summary>Reading an own calendar (iCalendar): the times only, a day at a time, in Berlin.</summary>
public class CalendarTests
{
    private const string Ics = """
        BEGIN:VCALENDAR
        VERSION:2.0
        PRODID:-//Test//DE
        BEGIN:VEVENT
        UID:weekly
        DTSTART;TZID=Europe/Berlin:20261202T080000
        DTEND;TZID=Europe/Berlin:20261202T093000
        RRULE:FREQ=WEEKLY;COUNT=3
        SUMMARY:Zahnarzt
        END:VEVENT
        BEGIN:VEVENT
        UID:allday
        DTSTART;VALUE=DATE:20261210
        DTEND;VALUE=DATE:20261212
        SUMMARY:Urlaub privat
        END:VEVENT
        BEGIN:VEVENT
        UID:utc
        DTSTART:20261203T120000Z
        DTEND:20261203T130000Z
        SUMMARY:Mittag
        END:VEVENT
        BEGIN:VEVENT
        UID:free
        DTSTART;TZID=Europe/Berlin:20261204T100000
        DTEND;TZID=Europe/Berlin:20261204T110000
        TRANSP:TRANSPARENT
        SUMMARY:nur Info
        END:VEVENT
        END:VCALENDAR
        """;

    [Fact]
    public void Reads_recurring_whole_day_and_utc_appointments_but_not_free_ones()
    {
        var busy = CalendarEndpoints.Parse(Ics, new DateOnly(2026, 12, 1), new DateOnly(2026, 12, 31));
        Assert.Equal(
        [
            (new DateOnly(2026, 12, 2), (TimeOnly?)new TimeOnly(8, 0), (TimeOnly?)new TimeOnly(9, 30)),
            (new DateOnly(2026, 12, 3), new TimeOnly(13, 0), new TimeOnly(14, 0)),
            (new DateOnly(2026, 12, 9), new TimeOnly(8, 0), new TimeOnly(9, 30)),
            (new DateOnly(2026, 12, 10), null, null),
            (new DateOnly(2026, 12, 11), null, null),
            (new DateOnly(2026, 12, 16), new TimeOnly(8, 0), new TimeOnly(9, 30)),
        ], busy.OrderBy(b => b.Date).ToList());
    }

    /// <summary>As Apple writes it: an endless series first, appointments far ahead before near ones, a moved one.</summary>
    private const string Mixed = """
        BEGIN:VCALENDAR
        VERSION:2.0
        PRODID:-//Apple Inc.//macOS//EN
        BEGIN:VEVENT
        UID:far
        DTSTART;TZID=Europe/Berlin:20270310T100000
        DTEND;TZID=Europe/Berlin:20270310T110000
        SUMMARY:weit weg
        END:VEVENT
        BEGIN:VEVENT
        UID:endless
        DTSTART;TZID=Europe/Berlin:20250106T070000
        DTEND;TZID=Europe/Berlin:20250106T073000
        RRULE:FREQ=WEEKLY;BYDAY=MO
        SUMMARY:jede Woche
        END:VEVENT
        BEGIN:VEVENT
        UID:endless
        RECURRENCE-ID;TZID=Europe/Berlin:20261207T070000
        DTSTART;TZID=Europe/Berlin:20261207T090000
        DTEND;TZID=Europe/Berlin:20261207T093000
        SUMMARY:jede Woche, verschoben
        END:VEVENT
        BEGIN:VEVENT
        UID:near
        DTSTART;TZID=Europe/Berlin:20261203T150000
        DTEND;TZID=Europe/Berlin:20261203T160000
        SUMMARY:bald
        END:VEVENT
        END:VCALENDAR
        """;

    [Fact]
    public void Reads_every_appointment_in_the_range_whatever_the_order()
    {
        var busy = CalendarEndpoints.Parse(Mixed, new DateOnly(2026, 12, 1), new DateOnly(2026, 12, 14)).OrderBy(b => b.Date).ThenBy(b => b.Start).ToList();
        Assert.Equal(
        [
            (new DateOnly(2026, 12, 3), (TimeOnly?)new TimeOnly(15, 0), (TimeOnly?)new TimeOnly(16, 0)),
            (new DateOnly(2026, 12, 7), new TimeOnly(9, 0), new TimeOnly(9, 30)),
            (new DateOnly(2026, 12, 14), new TimeOnly(7, 0), new TimeOnly(7, 30)),
        ], busy);
    }

    [Theory]
    [InlineData("webcal://p52-caldav.icloud.com/published/2/abc", "https://p52-caldav.icloud.com/published/2/abc")]
    [InlineData("https://calendar.google.com/calendar/ical/x/basic.ics", "https://calendar.google.com/calendar/ical/x/basic.ics")]
    [InlineData("http://p52-caldav.icloud.com/x", null)]
    [InlineData("https://evil.example.com/icloud.com", null)]
    [InlineData("https://10.0.0.1/cal.ics", null)]
    public void Reads_calendars_only_from_known_hosts_by_https(string url, string? expected) =>
        Assert.Equal(expected, CalendarEndpoints.Normalize(url)?.ToString());
}
