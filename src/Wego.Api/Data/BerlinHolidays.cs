namespace Wego.Api.Data;

/// <summary>
/// The public holidays of Berlin, computed: they count as free days (no vacation), also in years whose
/// holidays were not loaded under Verwaltung.
/// </summary>
public static class BerlinHolidays
{
    public static IReadOnlyList<DateOnly> Of(int year) => Named(year).Select(h => h.Date).ToList();

    /// <summary>The holidays of a year with their names.</summary>
    public static IReadOnlyList<(DateOnly Date, string Name)> Named(int year)
    {
        var easter = EasterSunday(year);
        return
        [
            (new DateOnly(year, 1, 1), "Neujahr"),
            (new DateOnly(year, 3, 8), "Internationaler Frauentag"),
            (easter.AddDays(-2), "Karfreitag"),
            (easter.AddDays(1), "Ostermontag"),
            (new DateOnly(year, 5, 1), "Tag der Arbeit"),
            (easter.AddDays(39), "Christi Himmelfahrt"),
            (easter.AddDays(50), "Pfingstmontag"),
            (new DateOnly(year, 10, 3), "Tag der Deutschen Einheit"),
            (new DateOnly(year, 12, 25), "1. Weihnachtsfeiertag"),
            (new DateOnly(year, 12, 26), "2. Weihnachtsfeiertag"),
        ];
    }

    public static bool IsHoliday(DateOnly day) => Of(day.Year).Contains(day);

    /// <summary>Easter Sunday after the Gregorian calendar (Meeus/Jones/Butcher).</summary>
    public static DateOnly EasterSunday(int year)
    {
        int a = year % 19, b = year / 100, c = year % 100, d = b / 4, e = b % 4;
        int f = (b + 8) / 25, g = (b - f + 1) / 3, h = (19 * a + b - d - g + 15) % 30;
        int i = c / 4, k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = (a + 11 * h + 22 * l) / 451;
        int month = (h + l - 7 * m + 114) / 31, day = (h + l - 7 * m + 114) % 31 + 1;
        return new DateOnly(year, month, day);
    }
}
