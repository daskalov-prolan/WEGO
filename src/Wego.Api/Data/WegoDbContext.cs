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
    public DbSet<SchoolHoliday> SchoolHolidays => Set<SchoolHoliday>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Employee>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.UserName).HasMaxLength(100);
            e.Property(x => x.Role).HasMaxLength(50);
            e.Property(x => x.MainActivity).HasConversion<string>().HasMaxLength(30);
            // Stored as a comma separated list of names, e.g. "Abriss,RenoDeco".
            e.Property(x => x.AdditionalActivities)
                .HasConversion(
                    v => string.Join(',', v),
                    v => v.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(Enum.Parse<Activity>).ToList(),
                    new ValueComparer<List<Activity>>(
                        (a, b) => a!.SequenceEqual(b!),
                        v => v.Aggregate(0, (hash, activity) => HashCode.Combine(hash, activity)),
                        v => v.ToList()))
                .HasMaxLength(200);
            e.HasIndex(x => x.UserName).IsUnique();
        });

        modelBuilder.Entity<Site>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(220);
            e.Property(x => x.Client).HasMaxLength(200);
            e.Property(x => x.LabelProjectNumber).HasMaxLength(50);
            e.Property(x => x.Street).HasMaxLength(200);
            e.Property(x => x.HouseNumber).HasMaxLength(20);
            e.Property(x => x.AddressAddition).HasMaxLength(200);
            e.Property(x => x.PostalCode).HasMaxLength(10);
            e.Property(x => x.City).HasMaxLength(100);
            e.Property(x => x.NameSource).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Description).HasMaxLength(1000);
            // Not unique: one property management can order jobs at several addresses.
            e.HasIndex(x => x.Name);
        });

        modelBuilder.Entity<SiteTask>(e =>
        {
            e.Property(x => x.Activity).HasConversion<string>().HasMaxLength(30);
            e.HasOne(x => x.Site).WithMany(x => x.Tasks).HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Cascade);
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
            e.Property(x => x.Activity).HasConversion<string>().HasMaxLength(30);
            e.HasIndex(x => new { x.EmployeeId, x.Date });
            e.HasIndex(x => new { x.SiteId, x.Date });
            e.HasOne(x => x.Employee).WithMany(x => x.Entries).HasForeignKey(x => x.EmployeeId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Site).WithMany(x => x.Entries).HasForeignKey(x => x.SiteId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<SchoolHoliday>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
        });
    }
}
