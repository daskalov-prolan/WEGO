using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Wego.Api.Data;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <summary>
    /// The offer phase begins with the enquiry of the customer: "Anfrage" comes first among its activities, before
    /// Besichtigung. Left out when an activity with that key was made under Verwaltung already. Objektauswahl takes
    /// a warm terracotta (with white writing) where its petrol was not changed under Verwaltung.
    /// </summary>
    [DbContext(typeof(WegoDbContext))]
    [Migration("20261110090000_ActivityAnfrage")]
    public partial class ActivityAnfrage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                INSERT INTO "Activities" ("Key", "Label", "Phase", "SortOrder", "Color")
                SELECT 'Anfrage', 'Anfrage', 'Angebot',
                       COALESCE((SELECT MIN("SortOrder") FROM "Activities"), 1) - 1, '#b8a47a'
                WHERE NOT EXISTS (SELECT 1 FROM "Activities" WHERE "Key" = 'Anfrage');
                UPDATE "Activities" SET "Color" = '#c77f6b' WHERE "Key" = 'Objektauswahl' AND lower("Color") = '#0f6378';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM "Activities" WHERE "Key" = 'Anfrage'
                  AND NOT EXISTS (SELECT 1 FROM "PlanEntries" WHERE "Activity" = 'Anfrage');
                UPDATE "Activities" SET "Color" = '#0f6378' WHERE "Key" = 'Objektauswahl' AND lower("Color") = '#c77f6b';
                """);
        }
    }
}
