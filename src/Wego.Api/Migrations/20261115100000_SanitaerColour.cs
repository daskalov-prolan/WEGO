using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Wego.Api.Data;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <summary>
    /// Sanitär and Endmontage in a greyer petrol (#336471), apart from the petrol of the Besichtigung. Only colours not changed under Verwaltung.
    /// </summary>
    [DbContext(typeof(WegoDbContext))]
    [Migration("20261115100000_SanitaerColour")]
    public partial class SanitaerColour : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "Activities" SET "Color" = '#336471' WHERE "Key" IN ('Sanitaer', 'Endmontage') AND lower("Color") = '#0f6378';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "Activities" SET "Color" = '#0f6378' WHERE "Key" IN ('Sanitaer', 'Endmontage') AND lower("Color") = '#336471';
                """);
        }
    }
}
