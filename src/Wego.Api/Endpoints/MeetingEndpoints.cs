using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>
/// Meetings that come back every week (e.g. the Bauberatung on Wednesdays 9:00-10:30): kept by the planners, shown
/// in the plans of their participants. A week can be cancelled or moved on its own. A meeting is not on a public
/// holiday or in a company closure, and not for a participant on vacation or sick that day. A craftsman who cannot
/// take part in a week asks to be let off; a planner of group G decides.
/// </summary>
public static class MeetingEndpoints
{
    public const int MaxTitle = 100;
    public const int MaxReason = 300;

    public record ChangeDto(DateOnly Date, bool Cancelled, DateOnly? NewDate, TimeOnly? NewStartTime, TimeOnly? NewEndTime);

    public record AbsenceDto(DateOnly Date, int EmployeeId, string? Reason, AbsenceStatus Status, DateTime RequestedAt);

    public record MeetingDto(int Id, string Title, int Weekday, TimeOnly StartTime, TimeOnly EndTime, DateOnly StartsOn,
        DateOnly? EndsOn, IReadOnlyList<int> ParticipantIds, IReadOnlyList<ChangeDto> Changes, IReadOnlyList<AbsenceDto> Absences);

    /// <summary>A request to be let off one week, for a planner of group G to decide.</summary>
    public record RequestDto(int MeetingId, string Title, DateOnly Date, int EmployeeId, string Employee, string? Reason, DateTime RequestedAt);

    /// <summary>
    /// One week of a meeting: <paramref name="Date"/> the day it is on, <paramref name="OriginalDate"/> the day it
    /// would be on (another when moved); <paramref name="EmployeeIds"/> the participants who are there that day,
    /// <paramref name="Requested"/> those of them who asked to be let off (not decided yet); <paramref name="Names"/>
    /// the names of all participants, also for a craftsman who does not see the planners.
    /// </summary>
    public record OccurrenceDto(int MeetingId, string Title, DateOnly Date, DateOnly OriginalDate, TimeOnly StartTime,
        TimeOnly EndTime, IReadOnlyList<int> EmployeeIds, bool Moved, IReadOnlyList<int> Requested,
        IReadOnlyDictionary<int, string> Names);

    public record AbsenceInput(DateOnly Date, string? Reason);
    public record DecisionInput(DateOnly Date, int EmployeeId, bool Approve);

    public record MeetingInput(string Title, int Weekday, TimeOnly StartTime, TimeOnly EndTime, DateOnly StartsOn,
        DateOnly? EndsOn, int[] ParticipantIds);

    /// <summary>A week otherwise: cancelled, or moved (all three of the new day and times given).</summary>
    public record ChangeInput(DateOnly Date, bool Cancelled, DateOnly? NewDate, TimeOnly? NewStartTime, TimeOnly? NewEndTime);

    public static void MapMeetingEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/meetings").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (!user.CanPlan()) return Results.Forbid();
            var meetings = await Load(db).AsNoTracking()
                .OrderBy(m => m.Weekday).ThenBy(m => m.StartTime).ThenBy(m => m.Title).ToListAsync();
            return Results.Ok(meetings.Select(ToDto));
        });

        group.MapPost("/", async (MeetingInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (!user.CanPlan()) return Results.Forbid();
            var meeting = new Meeting { Title = "" };
            if (await ApplyAsync(db, meeting, input) is { } error) return ApiErrors.BadRequest(error);
            db.Meetings.Add(meeting);
            ChangeLog.Add(db, user, ChangeArea.Plan, "Wiederholungstermin angelegt", null, null, input);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(meeting));
        });

        group.MapPut("/{id:int}", async (int id, MeetingInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (!user.CanPlan()) return Results.Forbid();
            var meeting = await Load(db).FirstOrDefaultAsync(m => m.Id == id);
            if (meeting is null) return Results.NotFound();
            var before = ToDto(meeting);
            if (await ApplyAsync(db, meeting, input) is { } error) return ApiErrors.BadRequest(error);
            ChangeLog.Add(db, user, ChangeArea.Plan, "Wiederholungstermin geändert", id, before, input);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(meeting));
        });

        // The whole series goes: also the weeks gone by (it was a meeting, not work to count).
        group.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (!user.CanPlan()) return Results.Forbid();
            var meeting = await Load(db).FirstOrDefaultAsync(m => m.Id == id);
            if (meeting is null) return Results.NotFound();
            ChangeLog.Add(db, user, ChangeArea.Plan, "Wiederholungstermin gelöscht", id, ToDto(meeting), null);
            db.Meetings.Remove(meeting);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // One week otherwise; the same week again replaces it.
        group.MapPost("/{id:int}/changes", async (int id, ChangeInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (!user.CanPlan()) return Results.Forbid();
            var meeting = await Load(db).FirstOrDefaultAsync(m => m.Id == id);
            if (meeting is null) return Results.NotFound();
            if (!Dates(meeting, input.Date, input.Date).Any()) return ApiErrors.BadRequest("An diesem Tag ist der Termin nicht.");
            if (!input.Cancelled)
            {
                if (input.NewDate is null || input.NewStartTime is null || input.NewEndTime is null)
                    return ApiErrors.BadRequest("Bitte Tag, Beginn und Ende angeben.");
                if (input.NewEndTime <= input.NewStartTime) return ApiErrors.BadRequest("Das Ende liegt nach dem Beginn.");
            }
            var change = meeting.Changes.FirstOrDefault(c => c.Date == input.Date);
            if (change is null) meeting.Changes.Add(change = new MeetingChange { Date = input.Date });
            change.Cancelled = input.Cancelled;
            change.NewDate = input.Cancelled ? null : input.NewDate;
            change.NewStartTime = input.Cancelled ? null : input.NewStartTime;
            change.NewEndTime = input.Cancelled ? null : input.NewEndTime;
            ChangeLog.Add(db, user, ChangeArea.Plan, input.Cancelled ? "Wiederholungstermin abgesagt" : "Wiederholungstermin verschoben", id,
                null, input, input.Date);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(meeting));
        });

        // A participant cannot come one week: he asks to be let off (again, after a no).
        group.MapPost("/{id:int}/absences", async (int id, AbsenceInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var meeting = await Load(db).FirstOrDefaultAsync(m => m.Id == id);
            if (meeting is null) return Results.NotFound();
            var me = user.EmployeeId();
            if (meeting.Participants.All(p => p.EmployeeId != me)) return Results.Forbid();
            if (!Dates(meeting, input.Date, input.Date).Any()) return ApiErrors.BadRequest("An diesem Tag ist der Termin nicht.");
            var reason = string.IsNullOrWhiteSpace(input.Reason) ? null : input.Reason.Trim();
            if (reason?.Length > MaxReason) return ApiErrors.BadRequest($"Der Grund darf höchstens {MaxReason} Zeichen lang sein.");
            var absence = meeting.Absences.FirstOrDefault(a => a.Date == input.Date && a.EmployeeId == me);
            if (absence is null) meeting.Absences.Add(absence = new MeetingAbsence { Date = input.Date, EmployeeId = me });
            if (absence.Status != AbsenceStatus.Freigegeben)
            {
                absence.Status = AbsenceStatus.Beantragt;
                absence.Reason = reason;
                absence.RequestedAt = DateTime.UtcNow;
                absence.DecidedBy = null;
            }
            ChangeLog.Add(db, user, ChangeArea.Plan, "Wiederholungstermin: Absage beantragt", id, null, input, input.Date);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(meeting));
        });

        // Asked by mistake: taken back while not decided.
        group.MapDelete("/{id:int}/absences", async (int id, DateOnly date, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var meeting = await Load(db).FirstOrDefaultAsync(m => m.Id == id);
            if (meeting is null) return Results.NotFound();
            var me = user.EmployeeId();
            if (meeting.Absences.FirstOrDefault(a => a.Date == date && a.EmployeeId == me && a.Status == AbsenceStatus.Beantragt) is { } absence)
            {
                meeting.Absences.Remove(absence);
                ChangeLog.Add(db, user, ChangeArea.Plan, "Wiederholungstermin: Absage zurückgenommen", id, null, null, date);
                await db.SaveChangesAsync();
            }
            return Results.Ok(ToDto(meeting));
        });

        // The requests not decided yet, for a planner of group G.
        group.MapGet("/requests", async (ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (!user.IsPlanerG()) return Results.Forbid();
            var requests = await db.Set<MeetingAbsence>().AsNoTracking().Include(a => a.Meeting).Include(a => a.Employee)
                .Where(a => a.Status == AbsenceStatus.Beantragt)
                .OrderBy(a => a.Date).ThenBy(a => a.RequestedAt).ToListAsync();
            return Results.Ok(requests.Select(a => new RequestDto(a.MeetingId, a.Meeting.Title, a.Date, a.EmployeeId, a.Employee.Name, a.Reason, a.RequestedAt)));
        });

        // A planner of group G lets him off that week, or not.
        group.MapPost("/{id:int}/absences/decide", async (int id, DecisionInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (!user.IsPlanerG()) return Results.Forbid();
            var meeting = await Load(db).FirstOrDefaultAsync(m => m.Id == id);
            if (meeting is null) return Results.NotFound();
            var absence = meeting.Absences.FirstOrDefault(a => a.Date == input.Date && a.EmployeeId == input.EmployeeId);
            if (absence is null) return ApiErrors.BadRequest("Diese Anfrage gibt es nicht (mehr).");
            absence.Status = input.Approve ? AbsenceStatus.Freigegeben : AbsenceStatus.Abgelehnt;
            absence.DecidedBy = user.FindFirstValue(ClaimTypes.Name);
            ChangeLog.Add(db, user, ChangeArea.Plan, input.Approve ? "Wiederholungstermin: Absage freigegeben" : "Wiederholungstermin: Absage abgelehnt",
                id, null, input, input.Date);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(meeting));
        });

        // A week as in the series again.
        group.MapDelete("/{id:int}/changes", async (int id, DateOnly date, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (!user.CanPlan()) return Results.Forbid();
            var meeting = await Load(db).FirstOrDefaultAsync(m => m.Id == id);
            if (meeting is null) return Results.NotFound();
            if (meeting.Changes.FirstOrDefault(c => c.Date == date) is { } change)
            {
                meeting.Changes.Remove(change);
                ChangeLog.Add(db, user, ChangeArea.Plan, "Wiederholungstermin wie in der Reihe", id, null, null, date);
                await db.SaveChangesAsync();
            }
            return Results.Ok(ToDto(meeting));
        });
    }

    private static async Task<string?> ApplyAsync(WegoDbContext db, Meeting meeting, MeetingInput input)
    {
        var title = input.Title?.Trim() ?? "";
        if (title.Length == 0 || title.Length > MaxTitle) return $"Bitte einen Namen mit höchstens {MaxTitle} Zeichen angeben.";
        if (input.Weekday is < 1 or > 7) return "Bitte einen Wochentag wählen.";
        if (input.EndTime <= input.StartTime) return "Das Ende liegt nach dem Beginn.";
        if (input.EndsOn is { } ends && ends < input.StartsOn) return "Das Ende der Reihe liegt nach ihrem Beginn.";
        var ids = (input.ParticipantIds ?? []).Distinct().ToList();
        if (ids.Count == 0) return "Bitte mindestens einen Teilnehmer wählen.";
        var known = await db.Employees.Where(e => ids.Contains(e.Id) && e.IsActive && e.DeletedAt == null).Select(e => e.Id).ToListAsync();
        if (known.Count != ids.Count) return "Einen der Teilnehmer gibt es nicht (mehr).";
        meeting.Title = title;
        meeting.Weekday = input.Weekday;
        meeting.StartTime = input.StartTime;
        meeting.EndTime = input.EndTime;
        meeting.StartsOn = input.StartsOn;
        meeting.EndsOn = input.EndsOn;
        meeting.Participants.RemoveAll(p => !ids.Contains(p.EmployeeId));
        foreach (var id in ids.Where(id => meeting.Participants.All(p => p.EmployeeId != id)))
            meeting.Participants.Add(new MeetingParticipant { EmployeeId = id });
        return null;
    }

    private static IQueryable<Meeting> Load(WegoDbContext db) =>
        db.Meetings.Include(m => m.Participants).ThenInclude(p => p.Employee).Include(m => m.Changes).Include(m => m.Absences);

    public static MeetingDto ToDto(Meeting m) => new(m.Id, m.Title, m.Weekday, m.StartTime, m.EndTime, m.StartsOn, m.EndsOn,
        m.Participants.Select(p => p.EmployeeId).OrderBy(id => id).ToList(),
        m.Changes.OrderBy(c => c.Date).Select(c => new ChangeDto(c.Date, c.Cancelled, c.NewDate, c.NewStartTime, c.NewEndTime)).ToList(),
        m.Absences.OrderBy(a => a.Date).Select(a => new AbsenceDto(a.Date, a.EmployeeId, a.Reason, a.Status, a.RequestedAt)).ToList());

    /// <summary>The days of the series from..to (its weekday, within its start and end).</summary>
    private static IEnumerable<DateOnly> Dates(Meeting m, DateOnly from, DateOnly to)
    {
        var first = from < m.StartsOn ? m.StartsOn : from;
        var last = m.EndsOn is { } ends && ends < to ? ends : to;
        var day = first.AddDays(((m.Weekday % 7) - (int)first.DayOfWeek + 7) % 7);
        for (; day <= last; day = day.AddDays(7)) yield return day;
    }

    /// <summary>
    /// The weeks of the meetings from..to, as they are: moved ones on their new day, cancelled ones left out, none on a
    /// public holiday or in a company closure, a participant left out on a day of vacation or sickness.
    /// </summary>
    public static async Task<List<OccurrenceDto>> OccurrencesAsync(WegoDbContext db, DateOnly from, DateOnly to, int? employeeId = null)
    {
        var meetings = await Load(db).AsNoTracking()
            .Where(m => m.StartsOn <= to.AddDays(7) && (m.EndsOn == null || m.EndsOn >= from.AddDays(-7)))
            .Where(m => employeeId == null || m.Participants.Any(p => p.EmployeeId == employeeId))
            .ToListAsync();
        if (meetings.Count == 0) return [];

        // A week moved by up to a few days may come into the range from outside it.
        var wideFrom = from.AddDays(-14);
        var wideTo = to.AddDays(14);
        var off = await SchoolHolidayEndpoints.PublicHolidaysAsync(db, wideFrom, wideTo);
        var closures = await db.SchoolHolidays.AsNoTracking()
            .Where(h => h.Kind == HolidayKind.Betriebsferien && h.StartDate <= wideTo && h.EndDate >= wideFrom)
            .Select(h => new { h.StartDate, h.EndDate }).ToListAsync();
        bool Closed(DateOnly d) => off.Contains(d) || closures.Any(c => c.StartDate <= d && d <= c.EndDate);
        var people = meetings.SelectMany(m => m.Participants.Select(p => p.EmployeeId)).Distinct().ToList();
        var away = (await db.PlanEntries.AsNoTracking()
                .Where(e => (e.Type == EntryType.Urlaub || e.Type == EntryType.Krank) && people.Contains(e.EmployeeId)
                    && e.Date >= wideFrom && e.Date <= wideTo)
                .Select(e => new { e.EmployeeId, e.Date }).ToListAsync())
            .Select(e => (e.EmployeeId, e.Date)).ToHashSet();

        var result = new List<OccurrenceDto>();
        foreach (var m in meetings)
        {
            foreach (var original in Dates(m, wideFrom, wideTo))
            {
                var change = m.Changes.FirstOrDefault(c => c.Date == original);
                if (change?.Cancelled == true) continue;
                var date = change?.NewDate ?? original;
                if (date < from || date > to || Closed(date)) continue;
                // Not there: away that day, or let off that week.
                var letOff = m.Absences.Where(a => a.Date == original).ToList();
                var there = m.Participants.Select(p => p.EmployeeId).Where(id => !away.Contains((id, date)))
                    .Where(id => !letOff.Any(a => a.EmployeeId == id && a.Status == AbsenceStatus.Freigegeben))
                    .Where(id => employeeId == null || id == employeeId).OrderBy(id => id).ToList();
                if (there.Count == 0) continue;
                var asked = letOff.Where(a => a.Status == AbsenceStatus.Beantragt && there.Contains(a.EmployeeId)).Select(a => a.EmployeeId).ToList();
                result.Add(new OccurrenceDto(m.Id, m.Title, date, original, change?.NewStartTime ?? m.StartTime,
                    change?.NewEndTime ?? m.EndTime, there, change is not null, asked,
                    m.Participants.ToDictionary(p => p.EmployeeId, p => p.Employee.Name)));
            }
        }
        return result.OrderBy(o => o.Date).ThenBy(o => o.StartTime).ToList();
    }
}
