using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Wego.Api.Data;

public class WegoDbContext(DbContextOptions<WegoDbContext> options) : DbContext(options)
{
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<Site> Sites => Set<Site>();
    public DbSet<SiteStatusChange> SiteStatusChanges => Set<SiteStatusChange>();
    public DbSet<SiteTask> SiteTasks => Set<SiteTask>();
    public DbSet<PlanEntry> PlanEntries => Set<PlanEntry>();
    public DbSet<SiteHourlyRate> SiteHourlyRates => Set<SiteHourlyRate>();
    public DbSet<SchoolHoliday> SchoolHolidays => Set<SchoolHoliday>();
    public DbSet<CalendarNote> CalendarNotes => Set<CalendarNote>();
    public DbSet<ClosureVacation> ClosureVacations => Set<ClosureVacation>();
    public DbSet<ChangeLogEntry> ChangeLog => Set<ChangeLogEntry>();
    public DbSet<ActivityType> Activities => Set<ActivityType>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ActivityType>(e =>
        {
            e.ToTable("Activities");
            e.HasKey(x => x.Key);
            e.Property(x => x.Key).HasMaxLength(30);
            e.Property(x => x.Label).HasMaxLength(100);
            e.Property(x => x.Phase).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Color).HasMaxLength(20);
        });

        modelBuilder.Entity<Employee>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.UserName).HasMaxLength(100);
            e.Property(x => x.Role).HasMaxLength(50);
            e.Property(x => x.MainActivity).HasMaxLength(30);
            e.Property(x => x.HourlyRate).HasPrecision(8, 2);
            e.Property(x => x.Phone).HasMaxLength(50);
            // A deleted activity is no longer the main activity of anybody.
            e.HasOne<ActivityType>().WithMany().HasForeignKey(x => x.MainActivity).OnDelete(DeleteBehavior.SetNull);
            // Stored as a comma separated list of keys, e.g. "Abriss,RenoDeco".
            e.Property(x => x.AdditionalActivities)
                .HasConversion(
                    v => string.Join(',', v),
                    v => v.Split(',', StringSplitOptions.RemoveEmptyEntries).ToList(),
                    new ValueComparer<List<string>>(
                        (a, b) => a!.SequenceEqual(b!),
                        v => v.Aggregate(0, (hash, activity) => HashCode.Combine(hash, activity)),
                        v => v.ToList()))
                .HasMaxLength(400);
            e.HasIndex(x => x.UserName).IsUnique();
        });

        modelBuilder.Entity<Site>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(220);
            e.Property(x => x.Client).HasMaxLength(200);
            e.Property(x => x.ClientPhone).HasMaxLength(50);
            e.Property(x => x.Salutation).HasMaxLength(20);
            e.Property(x => x.LabelProjectNumber).HasMaxLength(50);
            e.Property(x => x.Street).HasMaxLength(200);
            e.Property(x => x.HouseNumber).HasMaxLength(20);
            e.Property(x => x.AddressAddition).HasMaxLength(200);
            e.Property(x => x.PostalCode).HasMaxLength(10);
            e.Property(x => x.City).HasMaxLength(100);
            e.Property(x => x.NameSource).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Description).HasMaxLength(1000);
            // Stored as a list separated by "|": the scopes are fixed words without it.
            e.Property(x => x.Scope)
                .HasConversion(
                    v => string.Join('|', v),
                    v => v.Split('|', StringSplitOptions.RemoveEmptyEntries).ToList(),
                    new ValueComparer<List<string>>(
                        (a, b) => a!.SequenceEqual(b!),
                        v => v.Aggregate(0, (hash, scope) => HashCode.Combine(hash, scope)),
                        v => v.ToList()))
                .HasMaxLength(400);
            e.Property(x => x.DeclineReason).HasMaxLength(60);
            e.Property(x => x.DeclineNote).HasMaxLength(500);
            // Not unique: one property management can order jobs at several addresses.
            e.HasIndex(x => x.Name);
            e.HasOne(x => x.ResponsiblePlanner).WithMany().HasForeignKey(x => x.ResponsiblePlannerId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<SiteTask>(e =>
        {
            e.Property(x => x.Activity).HasMaxLength(30);
            e.HasOne(x => x.Site).WithMany(x => x.Tasks).HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Cascade);
            // A deleted activity is no task of any site any more.
            e.HasOne<ActivityType>().WithMany().HasForeignKey(x => x.Activity).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.SiteId, x.Activity }).IsUnique();
        });

        modelBuilder.Entity<SiteStatusChange>(e =>
        {
            e.Property(x => x.From).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.To).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.ChangedBy).HasMaxLength(200);
            e.HasOne(x => x.Site).WithMany(x => x.StatusChanges).HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.SiteId, x.ChangedAt });
        });

        modelBuilder.Entity<PlanEntry>(e =>
        {
            e.Property(x => x.Note).HasMaxLength(500);
            e.Property(x => x.Activity).HasMaxLength(30);
            // Entries of a deleted activity stay, without an activity.
            e.HasOne<ActivityType>().WithMany().HasForeignKey(x => x.Activity).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => new { x.EmployeeId, x.Date });
            e.HasIndex(x => new { x.SiteId, x.Date });
            e.HasOne(x => x.Employee).WithMany(x => x.Entries).HasForeignKey(x => x.EmployeeId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Site).WithMany(x => x.Entries).HasForeignKey(x => x.SiteId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<SiteHourlyRate>(e =>
        {
            e.HasKey(x => new { x.SiteId, x.EmployeeId });
            e.Property(x => x.HourlyRate).HasPrecision(8, 2);
            e.HasOne(x => x.Site).WithMany(x => x.HourlyRates).HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Employee).WithMany().HasForeignKey(x => x.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<SchoolHoliday>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
        });

        modelBuilder.Entity<Site>().Property(x => x.GeocodedFor).HasMaxLength(500);

        modelBuilder.Entity<CalendarNote>(e =>
        {
            e.Property(x => x.Title).HasMaxLength(Endpoints.CalendarNoteEndpoints.MaxTitle);
            e.Property(x => x.Text).HasMaxLength(Endpoints.CalendarNoteEndpoints.MaxText);
            e.HasIndex(x => new { x.EmployeeId, x.Date });
            e.HasOne(x => x.Employee).WithMany().HasForeignKey(x => x.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ClosureVacation>(e =>
        {
            e.HasKey(x => new { x.HolidayId, x.EmployeeId });
            e.HasOne(x => x.Holiday).WithMany().HasForeignKey(x => x.HolidayId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Employee).WithMany().HasForeignKey(x => x.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ChangeLogEntry>(e =>
        {
            e.Property(x => x.ChangedBy).HasMaxLength(200);
            e.Property(x => x.Area).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Action).HasMaxLength(50);
            e.Property(x => x.Before).HasColumnType("jsonb");
            e.Property(x => x.After).HasColumnType("jsonb");
            // No foreign keys: the log outlives deleted sites and employees.
            e.HasIndex(x => x.ChangedAt);
            e.HasIndex(x => new { x.Area, x.EntityId, x.Date });
        });
    }
}
