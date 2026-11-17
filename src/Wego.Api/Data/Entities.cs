namespace Wego.Api.Data;

/// <summary>
/// Handwerker only read the plan. Planer A plan (plan, sites, site reports), Planer G may do everything:
/// besides that the employees with their reports and vacation, and the administration.
/// </summary>
public static class Roles
{
    public const string Handwerker = "Handwerker";
    public const string PlanerA = "PlanerA";
    public const string PlanerG = "PlanerG";

    public static readonly string[] All = [Handwerker, PlanerA, PlanerG];

    public static bool CanPlan(string role) => role is PlanerA or PlanerG;
}

/// <summary>The authorization policies: planning (Planer A and G) and administration (Planer G).</summary>
public static class Policies
{
    public const string Plan = "Planen";
    public const string Admin = "Verwalten";
}

public enum EntryType
{
    Baustelle = 0,
    Urlaub = 1,
    Krank = 2,
}

/// <summary>
/// What an employee does on a construction site that day. Planners of group G keep the list under
/// Verwaltung: each activity belongs to one phase of a site, the offer (Angebot) or the construction
/// (Bauphase), and the order is that of the job.
/// </summary>
public class ActivityType
{
    /// <summary>Stable key stored in entries, tasks and employees (e.g. "Sanitaer"); the label can change.</summary>
    public required string Key { get; set; }
    public required string Label { get; set; }
    /// <summary><see cref="SiteStatus.Angebot"/> or <see cref="SiteStatus.Bauphase"/>.</summary>
    public SiteStatus Phase { get; set; }
    public int SortOrder { get; set; }
    /// <summary>The colour in the plan, e.g. "#f46a6a".</summary>
    public required string Color { get; set; }
}

public class Employee
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;

    /// <summary>Shown as a column in the plan. Office staff with a login only can be hidden.</summary>
    public bool ShowInPlan { get; set; } = true;

    public int VacationDaysPerYear { get; set; } = 30;

    /// <summary>The secret of his calendar link: his own appointments for Apple, Google or Outlook to subscribe to.</summary>
    public string? CalendarToken { get; set; }

    /// <summary>A calendar of his own (e.g. iCloud, shared publicly): its appointments are shown as "belegt".</summary>
    public string? ExternalCalendarUrl { get; set; }
    public DateTime? ExternalCalendarSyncedAt { get; set; }
    /// <summary>Why the calendar could not be read the last time; null when it could.</summary>
    public string? ExternalCalendarError { get; set; }

    /// <summary>Telephone number, shown in the list of employees to everybody.</summary>
    public string? Phone { get; set; }

    /// <summary>
    /// Date of birth, entered by a Planer G. Everybody else sees only the day and month (the birthday), in the
    /// list of employees and in the plan.
    /// </summary>
    public DateOnly? BirthDate { get; set; }

    /// <summary>
    /// Wage per hour in euros, for the costing of a site afterwards (Planer G only). A site can have its own
    /// rate for an employee, see <see cref="SiteHourlyRate"/>.
    /// </summary>
    public decimal? HourlyRate { get; set; }

    /// <summary>What this employee typically does on a site (the key of an <see cref="ActivityType"/>).</summary>
    public string? MainActivity { get; set; }

    /// <summary>What this employee can do as well. Main and additional activities are what the plan offers for them.</summary>
    public List<string> AdditionalActivities { get; set; } = [];

    /// <summary>
    /// Planners: the region of their enquiries (see VisitEndpoints.Regions), for listing the visits there (and showing
    /// them on the map) together; null for no region.
    /// </summary>
    public string? Region { get; set; }

    // Login. Employees without a user name cannot sign in.
    public string? UserName { get; set; }
    public string? PasswordHash { get; set; }
    public string Role { get; set; } = Roles.Handwerker;

    /// <summary>Set when a planner assigned the password, so that only the employee knows the final one.</summary>
    public bool MustChangePassword { get; set; }

    /// <summary>
    /// Deleted by a Planer G: no login, no longer to be planned or changed. The entries in the plan stay, and the
    /// lists show the employee at the end as deleted.
    /// </summary>
    public DateTime? DeletedAt { get; set; }

    public List<PlanEntry> Entries { get; set; } = [];
}

/// <summary>
/// Where a construction site stands, in this order. Storniert is no longer offered; old sites may still have it.
/// Abgelehnt: the customer said no to the offer (with a reason, see OfferEndpoints).
/// </summary>
public enum SiteStatus
{
    Angebot,
    Bauphase,
    Abgeschlossen,
    Storniert,
    Abgelehnt,
}

public static class SiteStatusFlow
{
    /// <summary>
    /// The allowed status changes: forward one step, or back from done to the construction phase (more to do
    /// after all). Cancelling is no longer possible.
    /// </summary>
    public static bool CanChange(SiteStatus from, SiteStatus to) =>
        (from, to) switch
        {
            (SiteStatus.Angebot, SiteStatus.Bauphase) => true,
            (SiteStatus.Bauphase, SiteStatus.Abgeschlossen) => true,
            (SiteStatus.Abgeschlossen, SiteStatus.Bauphase) => true,
            _ => false,
        };
}

/// <summary>
/// An activity a site needs in its status, generated when the site enters the status. It is fully planned
/// when the plan has as many employee days with this activity at the site as estimated, or when it is not needed.
/// </summary>
public class SiteTask
{
    public int Id { get; set; }
    public int SiteId { get; set; }
    public Site Site { get; set; } = null!;
    /// <summary>The key of an <see cref="ActivityType"/>.</summary>
    public required string Activity { get; set; }

    /// <summary>Employee days the activity is expected to take; at least one.</summary>
    public int EstimatedDays { get; set; } = 1;

    public bool NotNeeded { get; set; }
}

/// <summary>
/// A customer called for a visit and not reached: when and by whom, shown on the card of the enquiry so the planners
/// can answer when the customer asks.
/// </summary>
public class CallAttempt
{
    public int Id { get; set; }
    public int SiteId { get; set; }
    public Site Site { get; set; } = null!;
    public int EmployeeId { get; set; }
    public Employee Employee { get; set; } = null!;
    public DateTime At { get; set; }
}

/// <summary>One change of the status of a site, kept as a log.</summary>
public class SiteStatusChange
{
    public int Id { get; set; }
    public int SiteId { get; set; }
    public Site Site { get; set; } = null!;
    /// <summary>Null for the first status when the site was created.</summary>
    public SiteStatus? From { get; set; }
    public SiteStatus To { get; set; }
    public DateTime ChangedAt { get; set; }
    public string? ChangedBy { get; set; }
}

/// <summary>Which field gives a construction site the name shown in the plan.</summary>
public enum SiteNameSource
{
    Auftraggeber,
    Strasse,
}

/// <summary>A construction site (Baustelle): who ordered the job and where it is.</summary>
public class Site
{
    public int Id { get; set; }

    /// <summary>Shown in the plan; derived from <see cref="Client"/> or the street, see <see cref="NameSource"/>.</summary>
    public string Name { get; private set; } = "";

    /// <summary>Auftraggeber: the customer or the property management.</summary>
    public string? Client { get; set; }

    /// <summary>Anrede of the customer: Herr, Frau or Familie (see SiteEndpoints.Salutations).</summary>
    public string? Salutation { get; set; }

    /// <summary>Telephone number of the customer, to call before a visit or the start of the work.</summary>
    public string? ClientPhone { get; set; }

    /// <summary>Number of the project in Label, the merchandise management software of the company.</summary>
    public string? LabelProjectNumber { get; set; }

    public string? Street { get; set; }
    public string? HouseNumber { get; set; }
    public string? AddressAddition { get; set; }
    public string? PostalCode { get; set; }
    public string? City { get; set; }

    public SiteNameSource NameSource { get; set; } = SiteNameSource.Auftraggeber;

    /// <summary>
    /// A service call (Serviceeinsatz): work done at one appointment, created from the day of the plan. It is a site
    /// for the plan, the way there and the costing, but stays out of the lists of sites.
    /// </summary>
    public bool IsService { get; set; }

    /// <summary>
    /// An appointment kept for a customer who has not confirmed it yet (unbestätigter Termin). It shows in the plan
    /// without colour and in the list of sites; once confirmed it becomes a site or a service call.
    /// </summary>
    public bool IsTentative { get; set; }

    public SiteStatus Status { get; set; } = SiteStatus.Angebot;

    /// <summary>The planner (Planer A or G) in charge of the site.</summary>
    public int? ResponsiblePlannerId { get; set; }
    public Employee? ResponsiblePlanner { get; set; }

    /// <summary>The place of the address on the map, looked up for <see cref="GeocodedFor"/> (null: not found).</summary>
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    /// <summary>The address the place was looked up for; when the address changes, it is looked up again.</summary>
    public string? GeocodedFor { get; set; }

    public List<SiteStatusChange> StatusChanges { get; set; } = [];
    public List<SiteTask> Tasks { get; set; } = [];

    /// <summary>Adds the activities of the current status that the site does not have yet.</summary>
    public void GenerateTasks(IEnumerable<ActivityType> activities)
    {
        foreach (var activity in activities.Where(a => a.Phase == Status).OrderBy(a => a.SortOrder))
        {
            if (Tasks.All(t => t.Activity != activity.Key)) Tasks.Add(new SiteTask { Activity = activity.Key });
        }
    }

    public DateOnly? PlannedStart { get; set; }
    public DateOnly? PlannedEnd { get; set; }

    /// <summary>The day the enquiry of the customer came in (Anfrage): where the offer phase begins.</summary>
    public DateOnly? RequestedOn { get; set; }

    /// <summary>What the customer would like done (Umfang), from a fixed list (see OfferEndpoints.Scopes).</summary>
    public List<string> Scope { get; set; } = [];

    /// <summary>Why the customer said no (see OfferEndpoints.DeclineReasons); only for a declined offer.</summary>
    public string? DeclineReason { get; set; }

    /// <summary>A few words to the reason, needed for "Sonstiges".</summary>
    public string? DeclineNote { get; set; }

    /// <summary>
    /// Where in the offer the customer said no: Besichtigung (while the visit is agreed), Objektauswahl,
    /// Angebotsuebergabe, or Wartet (waiting for the yes); only for a declined offer.
    /// </summary>
    public string? DeclineStep { get; set; }

    /// <summary>
    /// A no reported by who visits (on the telephone), with the reason and a few words: it waits for a planner to
    /// confirm it (then the offer is declined) or to discard it.
    /// </summary>
    public string? ReportedDeclineReason { get; set; }
    public string? ReportedDeclineNote { get; set; }
    public string? ReportedDeclineBy { get; set; }
    public DateTime? ReportedDeclineAt { get; set; }

    /// <summary>What is done there: kind of conversion, tiles, remarks.</summary>
    public string? Description { get; set; }

    public List<PlanEntry> Entries { get; set; } = [];

    /// <summary>Wages per hour of employees that differ on this site from their usual one.</summary>
    public List<SiteHourlyRate> HourlyRates { get; set; } = [];

    /// <summary>Sets <see cref="Name"/> from the chosen field; call after changing client, street or source.</summary>
    public void UpdateName()
    {
        var name = (NameSource == SiteNameSource.Strasse ? $"{Street} {HouseNumber}" : Client ?? "").Trim();
        // A service call says so in the plan, an appointment not confirmed yet as well.
        Name = IsTentative ? $"{TentativePrefix}{name}" : IsService ? $"{ServicePrefix}{name}" : name;
    }

    /// <summary>"? ": an appointment the customer has not confirmed yet.</summary>
    public const string TentativePrefix = "? ";

    /// <summary>SE: Serviceeinsatz, short enough for a field of the calendar.</summary>
    public const string ServicePrefix = "SE: ";
}
/// <summary>
/// The wage per hour of an employee on one site, changed in its costing afterwards. It takes the place of
/// <see cref="Employee.HourlyRate"/> on this site only.
/// </summary>
public class SiteHourlyRate
{
    public int SiteId { get; set; }
    public Site? Site { get; set; }
    public int EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    public decimal HourlyRate { get; set; }
}

/// <summary>
/// One entry in a day cell of an employee. A day can hold several entries
/// (split day), each with an optional time window.
/// </summary>
public class PlanEntry
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public Employee Employee { get; set; } = null!;
    public DateOnly Date { get; set; }
    public EntryType Type { get; set; }
    public int? SiteId { get; set; }
    public Site? Site { get; set; }
    /// <summary>The key of an <see cref="ActivityType"/>. An entry of the offer phase may have it without a site.</summary>
    public string? Activity { get; set; }
    public TimeOnly? StartTime { get; set; }
    public TimeOnly? EndTime { get; set; }
    public string? Note { get; set; }

    /// <summary>The note is very important: the plan shows a red exclamation mark.</summary>
    public bool NoteImportant { get; set; }
}

public enum HolidayKind
{
    Schulferien,
    Feiertag,
    /// <summary>The company is closed: every craftsman has vacation on its working days.</summary>
    Betriebsferien,
}

/// <summary>
/// A note in the field of an employee and a day of the plan, not tied to a site: the short title shows in
/// the field, the explanation when pointing at it.
/// </summary>
public class CalendarNote
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public Employee Employee { get; set; } = null!;
    public DateOnly Date { get; set; }
    public required string Title { get; set; }
    public string? Text { get; set; }
}

/// <summary>
/// A time an employee is busy after his own calendar (see <see cref="Employee.ExternalCalendarUrl"/>): only the time,
/// nothing of what it is. Without times the whole day.
/// </summary>
public class ExternalBusy
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public Employee Employee { get; set; } = null!;
    public DateOnly Date { get; set; }
    public TimeOnly? StartTime { get; set; }
    public TimeOnly? EndTime { get; set; }
}

/// <summary>
/// A meeting that comes back every week on the same day and time (e.g. the Bauberatung on Wednesdays 9:00-10:30),
/// with its participants. It is not kept as entries: each week it is in the plans of its participants, but not on a
/// public holiday, in a company closure, or for a participant on vacation or sick.
/// </summary>
public class Meeting
{
    public int Id { get; set; }
    public required string Title { get; set; }
    /// <summary>1 Monday to 7 Sunday.</summary>
    public int Weekday { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public DateOnly StartsOn { get; set; }
    /// <summary>The last day it may come on; null while it goes on.</summary>
    public DateOnly? EndsOn { get; set; }
    public List<MeetingParticipant> Participants { get; set; } = [];
    public List<MeetingChange> Changes { get; set; } = [];
    public List<MeetingAbsence> Absences { get; set; } = [];
}

public class MeetingParticipant
{
    public int MeetingId { get; set; }
    public Meeting Meeting { get; set; } = null!;
    public int EmployeeId { get; set; }
    public Employee Employee { get; set; } = null!;
}

public enum AbsenceStatus
{
    Beantragt,
    Freigegeben,
    Abgelehnt,
}

/// <summary>
/// A craftsman cannot take part in one week of a meeting: he asks, a planner of group G lets him off (then the week
/// is not in his plan) or not. Planners cancel or move a week themselves.
/// </summary>
public class MeetingAbsence
{
    public int Id { get; set; }
    public int MeetingId { get; set; }
    public Meeting Meeting { get; set; } = null!;
    /// <summary>The day of the series (as in <see cref="MeetingChange.Date"/>).</summary>
    public DateOnly Date { get; set; }
    public int EmployeeId { get; set; }
    public Employee Employee { get; set; } = null!;
    public string? Reason { get; set; }
    public AbsenceStatus Status { get; set; }
    public DateTime RequestedAt { get; set; }
    public string? DecidedBy { get; set; }
}

/// <summary>One week of a meeting otherwise: cancelled, or on another day or at another time.</summary>
public class MeetingChange
{
    public int Id { get; set; }
    public int MeetingId { get; set; }
    public Meeting Meeting { get; set; } = null!;
    /// <summary>The day it would have been on.</summary>
    public DateOnly Date { get; set; }
    public bool Cancelled { get; set; }
    public DateOnly? NewDate { get; set; }
    public TimeOnly? NewStartTime { get; set; }
    public TimeOnly? NewEndTime { get; set; }
}

/// <summary>
/// The vacation of a company closure was entered for this craftsman (once: when a planner takes a day of it
/// back, it does not come again).
/// </summary>
public class ClosureVacation
{
    public int HolidayId { get; set; }
    public SchoolHoliday Holiday { get; set; } = null!;
    public int EmployeeId { get; set; }
    public Employee Employee { get; set; } = null!;
}

/// <summary>Berlin school holidays and public holidays (Feiertage), shown in the plan.</summary>
public class SchoolHoliday
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public HolidayKind Kind { get; set; } = HolidayKind.Schulferien;
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
}

public enum ChangeArea
{
    Plan,
    Mitarbeiter,
    Baustelle,
    Taetigkeit,
}

/// <summary>
/// One change to the plan, an employee or a site: when, by whom, and the record before and after as JSON.
/// Only written, never shown in the application; it is read in the database when needed.
/// </summary>
public class ChangeLogEntry
{
    public long Id { get; set; }
    public DateTime ChangedAt { get; set; }
    public int? ChangedById { get; set; }
    /// <summary>The name at the time of the change, so it stays readable when the employee is renamed.</summary>
    public string? ChangedBy { get; set; }
    public ChangeArea Area { get; set; }
    /// <summary>What happened, e.g. "Angelegt", "Geändert", "Gelöscht", "Status".</summary>
    public required string Action { get; set; }
    /// <summary>The employee (also for plan days) or the site.</summary>
    public int? EntityId { get; set; }
    /// <summary>The day, for plan changes.</summary>
    public DateOnly? Date { get; set; }
    public string? Before { get; set; }
    public string? After { get; set; }
}
