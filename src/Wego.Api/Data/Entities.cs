namespace Wego.Api.Data;

public static class Roles
{
    public const string Planer = "Planer";
    public const string Mitarbeiter = "Mitarbeiter";
}

public enum EntryType
{
    Baustelle = 0,
    Urlaub = 1,
    Krank = 2,
}

/// <summary>
/// What an employee does on a construction site that day, in the order of the job. Each activity belongs
/// to one status of the site: the offer (Angebot) or the construction (Bauphase), see <see cref="ActivityPhases"/>.
/// </summary>
public enum Activity
{
    Besichtigung,
    Angebotskalkulation,
    Angebotsbesprechung,
    Abriss,
    Trockenbau,
    Sanitaer,
    RenoDeco,
    Fliesen,
    Endmontage,
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

    /// <summary>What this employee typically does on a site.</summary>
    public Activity? MainActivity { get; set; }

    /// <summary>What this employee can do as well. Main and additional activities are what the plan offers for them.</summary>
    public List<Activity> AdditionalActivities { get; set; } = [];

    // Login. Employees without a user name cannot sign in.
    public string? UserName { get; set; }
    public string? PasswordHash { get; set; }
    public string Role { get; set; } = Roles.Mitarbeiter;

    /// <summary>Set when a planner assigned the password, so that only the employee knows the final one.</summary>
    public bool MustChangePassword { get; set; }

    public List<PlanEntry> Entries { get; set; } = [];
}

/// <summary>Where a construction site stands. Storniert can follow any status; otherwise in this order.</summary>
public enum SiteStatus
{
    Angebot,
    Bauphase,
    Abgeschlossen,
    Storniert,
}

public static class ActivityPhases
{
    /// <summary>The activities of a status: the offer has its own, the construction the rest.</summary>
    public static readonly IReadOnlyDictionary<SiteStatus, Activity[]> ByStatus = new Dictionary<SiteStatus, Activity[]>
    {
        [SiteStatus.Angebot] = [Activity.Besichtigung, Activity.Angebotskalkulation, Activity.Angebotsbesprechung],
        [SiteStatus.Bauphase] =
        [
            Activity.Abriss, Activity.Trockenbau, Activity.Sanitaer, Activity.RenoDeco, Activity.Fliesen,
            Activity.Endmontage,
        ],
    };

    /// <summary>The allowed status changes: forward one step, or cancelled from anywhere.</summary>
    public static bool CanChange(SiteStatus from, SiteStatus to) =>
        (from, to) switch
        {
            (SiteStatus.Storniert, _) => false,
            (_, SiteStatus.Storniert) => true,
            (SiteStatus.Angebot, SiteStatus.Bauphase) => true,
            (SiteStatus.Bauphase, SiteStatus.Abgeschlossen) => true,
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
    public Activity Activity { get; set; }

    /// <summary>Employee days the activity is expected to take; at least one.</summary>
    public int EstimatedDays { get; set; } = 1;

    public bool NotNeeded { get; set; }
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

    /// <summary>Number of the project in Label, the merchandise management software of the company.</summary>
    public string? LabelProjectNumber { get; set; }

    public string? Street { get; set; }
    public string? HouseNumber { get; set; }
    public string? AddressAddition { get; set; }
    public string? PostalCode { get; set; }
    public string? City { get; set; }

    public SiteNameSource NameSource { get; set; } = SiteNameSource.Auftraggeber;

    public SiteStatus Status { get; set; } = SiteStatus.Angebot;
    public List<SiteStatusChange> StatusChanges { get; set; } = [];
    public List<SiteTask> Tasks { get; set; } = [];

    /// <summary>Adds the activities of the current status that the site does not have yet.</summary>
    public void GenerateTasks()
    {
        if (!ActivityPhases.ByStatus.TryGetValue(Status, out var activities)) return;
        foreach (var activity in activities)
        {
            if (Tasks.All(t => t.Activity != activity)) Tasks.Add(new SiteTask { Activity = activity });
        }
    }

    public DateOnly? PlannedStart { get; set; }
    public DateOnly? PlannedEnd { get; set; }

    /// <summary>What is done there: kind of conversion, tiles, remarks.</summary>
    public string? Description { get; set; }

    public List<PlanEntry> Entries { get; set; } = [];

    /// <summary>Sets <see cref="Name"/> from the chosen field; call after changing client, street or source.</summary>
    public void UpdateName() => Name = (NameSource == SiteNameSource.Strasse
        ? $"{Street} {HouseNumber}"
        : Client ?? "").Trim();
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
    public Activity? Activity { get; set; }
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
