using Microsoft.EntityFrameworkCore;

namespace Wego.Api.Data;

public class WegoDbContext(DbContextOptions<WegoDbContext> options) : DbContext(options)
{
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<PlanEntry> PlanEntries => Set<PlanEntry>();
    public DbSet<SchoolHoliday> SchoolHolidays => Set<SchoolHoliday>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Employee>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.UserName).HasMaxLength(100);
            e.Property(x => x.Role).HasMaxLength(50);
            e.HasIndex(x => x.UserName).IsUnique();
        });

        modelBuilder.Entity<Customer>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.HasIndex(x => x.Name).IsUnique();
        });

        modelBuilder.Entity<PlanEntry>(e =>
        {
            e.Property(x => x.Note).HasMaxLength(500);
            e.HasIndex(x => new { x.EmployeeId, x.Date });
            e.HasIndex(x => new { x.CustomerId, x.Date });
            e.HasOne(x => x.Employee).WithMany(x => x.Entries).HasForeignKey(x => x.EmployeeId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Customer).WithMany(x => x.Entries).HasForeignKey(x => x.CustomerId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<SchoolHoliday>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
        });
    }
}
