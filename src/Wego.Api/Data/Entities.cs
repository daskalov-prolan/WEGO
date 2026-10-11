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

public class Employee
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;

    /// <summary>Shown as a column in the plan. Office staff with a login only can be hidden.</summary>
    public bool ShowInPlan { get; set; } = true;

    public int VacationDaysPerYear { get; set; } = 30;

    // Login. Employees without a user name cannot sign in.
    public string? UserName { get; set; }
    public string? PasswordHash { get; set; }
    public string Role { get; set; } = Roles.Mitarbeiter;

    /// <summary>Set when a planner assigned the password, so that only the employee knows the final one.</summary>
    public bool MustChangePassword { get; set; }

    public List<PlanEntry> Entries { get; set; } = [];
}

/// <summary>A construction site, identified by the customer's name.</summary>
public class Customer
{
    public int Id { get; set; }
    public required string Name { get; set; }

    /// <summary>Address or district of the site, as the craftsmen need it to get there.</summary>
    public string? Location { get; set; }

    /// <summary>What is done there: kind of conversion, tiles, remarks.</summary>
    public string? Description { get; set; }

    public List<PlanEntry> Entries { get; set; } = [];
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
    public int? CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public TimeOnly? StartTime { get; set; }
    public TimeOnly? EndTime { get; set; }
    public string? Note { get; set; }
}

public class SchoolHoliday
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
}
