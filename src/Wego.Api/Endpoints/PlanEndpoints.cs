using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

public static class PlanEndpoints
{
    public const int MaxEntriesPerDay = 10;

    public record PlanEmployeeDto(int Id, string Name);
    public record CustomerDto(int Id, string Name, string? Location, string? Description);
    public record SchoolHolidayDto(int Id, string Name, DateOnly StartDate, DateOnly EndDate);
    public record EntryDto(int Id, int EmployeeId, string EmployeeName, DateOnly Date, EntryType Type,
        int? CustomerId, string? CustomerName, TimeOnly? StartTime, TimeOnly? EndTime, string? Note);
    public record PlanDto(int Year, IReadOnlyList<PlanEmployeeDto> Employees, IReadOnlyList<EntryDto> Entries,
        IReadOnlyList<SchoolHolidayDto> SchoolHolidays, IReadOnlyList<CustomerDto> Customers);

    public record DayEntryInput(EntryType Type, string? CustomerName, TimeOnly? StartTime, TimeOnly? EndTime,
        string? Note);
    public record UpdateCustomerRequest(string Name, string? Location, string? Description);

    public static void MapPlanEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/plan", async (int year, WegoDbContext db) =>
        {
            var (from, to) = YearRange(year);

            var entries = await EntriesQuery(db)
                .Where(e => e.Date >= from && e.Date <= to)
                .ToListAsync();

            // Former employees stay visible in the years they still have entries in.
            var withEntries = entries.Select(e => e.EmployeeId).ToHashSet();
            var employees = (await db.Employees
                    .Where(e => e.ShowInPlan)
                    .OrderBy(e => e.SortOrder).ThenBy(e => e.Name)
                    .ToListAsync())
                .Where(e => e.IsActive || withEntries.Contains(e.Id))
                .Select(e => new PlanEmployeeDto(e.Id, e.Name))
                .ToList();

            var holidays = await db.SchoolHolidays
                .Where(h => h.StartDate <= to && h.EndDate >= from)
                .OrderBy(h => h.StartDate)
                .Select(h => new SchoolHolidayDto(h.Id, h.Name, h.StartDate, h.EndDate))
                .ToListAsync();

            var customers = await db.Customers
                .OrderBy(c => c.Name)
                .Select(c => new CustomerDto(c.Id, c.Name, c.Location, c.Description))
                .ToListAsync();

            return new PlanDto(year, employees, Sort(entries.Select(ToDto)), holidays, customers);
        });

        // Replaces all entries of one employee on one day, so a split day is always saved as a whole.
        app.MapPut("/api/plan/{employeeId:int}/{date}", async (int employeeId, DateOnly date,
            DayEntryInput[] inputs, WegoDbContext db) =>
        {
            if (!await db.Employees.AnyAsync(e => e.Id == employeeId)) return Results.NotFound();

            var error = Validate(inputs);
            if (error is not null) return ApiErrors.BadRequest(error);

            await using var transaction = await db.Database.BeginTransactionAsync();

            var existing = await db.PlanEntries
                .Where(e => e.EmployeeId == employeeId && e.Date == date)
                .ToListAsync();
            db.PlanEntries.RemoveRange(existing);

            foreach (var input in inputs)
            {
                Customer? customer = null;
                if (input.Type == EntryType.Baustelle)
                    customer = await FindOrCreateCustomer(db, input.CustomerName!.Trim());

                db.PlanEntries.Add(new PlanEntry
                {
                    EmployeeId = employeeId,
                    Date = date,
                    Type = input.Type,
                    Customer = customer,
                    StartTime = input.StartTime,
                    EndTime = input.EndTime,
                    Note = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim(),
                });
            }

            await db.SaveChangesAsync();
            await transaction.CommitAsync();

            var saved = await EntriesQuery(db)
                .Where(e => e.EmployeeId == employeeId && e.Date == date)
                .ToListAsync();
            return Results.Ok(Sort(saved.Select(ToDto)));
        }).RequireAuthorization(Roles.Planer);

        app.MapGet("/api/customers", async (WegoDbContext db) =>
            await db.Customers
                .OrderBy(c => c.Name)
                .Select(c => new CustomerDto(c.Id, c.Name, c.Location, c.Description))
                .ToListAsync());

        // Renaming to the name of another customer merges both, which is how typos get cleaned up.
        app.MapPut("/api/customers/{id:int}", async (int id, UpdateCustomerRequest request, WegoDbContext db) =>
        {
            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > 200)
                return ApiErrors.BadRequest("Bitte einen Kundennamen mit höchstens 200 Zeichen angeben.");
            var location = Clean(request.Location);
            var description = Clean(request.Description);
            if (location?.Length > 200) return ApiErrors.BadRequest("Der Ort darf höchstens 200 Zeichen lang sein.");
            if (description?.Length > 1000)
                return ApiErrors.BadRequest("Die Beschreibung darf höchstens 1000 Zeichen lang sein.");

            var customer = await db.Customers.FindAsync(id);
            if (customer is null) return Results.NotFound();

            var target = await db.Customers
                .FirstOrDefaultAsync(c => c.Id != id && c.Name.ToLower() == name.ToLower());
            if (target is null)
            {
                customer.Name = name;
                customer.Location = location;
                customer.Description = description;
                await db.SaveChangesAsync();
                return Results.Ok(ToDto(customer));
            }

            // The site that remains keeps its own details and takes over only what it is missing.
            await using var transaction = await db.Database.BeginTransactionAsync();
            await db.PlanEntries.Where(e => e.CustomerId == id)
                .ExecuteUpdateAsync(s => s.SetProperty(e => e.CustomerId, target.Id));
            target.Location ??= location;
            target.Description ??= description;
            db.Customers.Remove(customer);
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Ok(ToDto(target));
        }).RequireAuthorization(Roles.Planer);
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static CustomerDto ToDto(Customer c) => new(c.Id, c.Name, c.Location, c.Description);

    public static (DateOnly From, DateOnly To) YearRange(int year) =>
        (new DateOnly(year, 1, 1), new DateOnly(year, 12, 31));

    public static IQueryable<PlanEntry> EntriesQuery(WegoDbContext db) =>
        db.PlanEntries.AsNoTracking().Include(e => e.Customer).Include(e => e.Employee);

    public static EntryDto ToDto(PlanEntry e) => new(e.Id, e.EmployeeId, e.Employee.Name, e.Date, e.Type,
        e.CustomerId, e.Customer?.Name, e.StartTime, e.EndTime, e.Note);

    public static List<EntryDto> Sort(IEnumerable<EntryDto> entries) => entries
        .OrderBy(e => e.Date)
        .ThenBy(e => e.StartTime ?? TimeOnly.MaxValue)
        .ThenBy(e => e.Id)
        .ToList();

    private static string? Validate(DayEntryInput[] inputs)
    {
        if (inputs.Length > MaxEntriesPerDay)
            return $"Pro Tag sind höchstens {MaxEntriesPerDay} Einträge möglich.";

        foreach (var input in inputs)
        {
            if (!Enum.IsDefined(input.Type)) return "Unbekannte Art des Eintrags.";

            if (input.Type == EntryType.Baustelle)
            {
                var name = input.CustomerName?.Trim();
                if (string.IsNullOrEmpty(name)) return "Bitte für jede Baustelle einen Kundennamen angeben.";
                if (name.Length > 200) return "Der Kundenname darf höchstens 200 Zeichen lang sein.";
            }

            if ((input.StartTime is null) != (input.EndTime is null))
                return "Bitte Beginn und Ende des Zeitfensters angeben oder beide leer lassen.";
            if (input.StartTime >= input.EndTime)
                return "Das Ende eines Zeitfensters muss nach dem Beginn liegen.";
            if (input.Note?.Length > 500) return "Die Notiz darf höchstens 500 Zeichen lang sein.";
        }

        var timed = inputs.Where(i => i.StartTime is not null).OrderBy(i => i.StartTime).ToList();
        for (var i = 1; i < timed.Count; i++)
        {
            if (timed[i].StartTime < timed[i - 1].EndTime)
                return "Die Zeitfenster eines Tages dürfen sich nicht überschneiden.";
        }

        return null;
    }

    private static async Task<Customer> FindOrCreateCustomer(WegoDbContext db, string name)
    {
        var local = db.Customers.Local
            .FirstOrDefault(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase));
        if (local is not null) return local;

        var customer = await db.Customers.FirstOrDefaultAsync(c => c.Name.ToLower() == name.ToLower());
        if (customer is null)
        {
            customer = new Customer { Name = name };
            db.Customers.Add(customer);
        }

        return customer;
    }
}
