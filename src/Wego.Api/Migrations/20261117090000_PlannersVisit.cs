using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Wego.Api.Data;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <summary>
    /// Who visits is no longer every planner, but whoever has the activity Besichtigung (ticked under Verwaltung). The
    /// planners who visit get it ticked: all active planners as before, but Rali Mateva, who does no visits.
    /// </summary>
    [DbContext(typeof(WegoDbContext))]
    [Migration("20261117090000_PlannersVisit")]
    public partial class PlannersVisit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "Employees"
                SET "AdditionalActivities" = CASE WHEN "AdditionalActivities" = '' THEN 'Besichtigung' ELSE "AdditionalActivities" || ',Besichtigung' END
                WHERE "Role" IN ('PlanerA', 'PlanerG') AND "IsActive" AND "DeletedAt" IS NULL
                  AND "Name" <> 'Rali Mateva'
                  AND "MainActivity" IS DISTINCT FROM 'Besichtigung'
                  AND (',' || "AdditionalActivities" || ',') NOT LIKE '%,Besichtigung,%';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
