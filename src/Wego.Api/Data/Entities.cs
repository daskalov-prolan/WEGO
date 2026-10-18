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
/// What an employee does on a construction site that day, in the order of the job:
/// Besichtigung, Abriss/Baubeginn, Trockenbau, Sanitär, RenoDeco-Platten, Fliesenarbeiten, Endmontage.
/// </summary>
public enum Activity
{
    Besichtigung,
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

    public string? Street { get; set; }
    public string? HouseNumber { get; set; }
    public string? AddressAddition { get; set; }
    public string? PostalCode { get; set; }
    public string? City { get; set; }

    public SiteNameSource NameSource { get; set; } = SiteNameSource.Auftraggeber;

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
