using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Wego.Api.Data;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <summary>
    /// The construction phase in calmer colours: RenoDeco Orange (as the Angebotsübergabe), Fliesenarbeiten Mauve, Trockenbau a lighter greige, Sanitär and Endmontage
    /// Petrol (Baubeginn keeps the red of the logo). Only colours not changed under Verwaltung.
    /// </summary>
    [DbContext(typeof(WegoDbContext))]
    [Migration("20261115090000_BuildColours")]
    public partial class BuildColours : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "Activities" SET "Color" = '#f07a2a' WHERE "Key" = 'RenoDeco' AND lower("Color") = '#ff9f50';
                UPDATE "Activities" SET "Color" = '#86698a' WHERE "Key" = 'Fliesen' AND lower("Color") = '#7a3e8e';
                UPDATE "Activities" SET "Color" = '#e9dccb' WHERE "Key" = 'Trockenbau' AND lower("Color") = '#d6c7bc';
                UPDATE "Activities" SET "Color" = '#0f6378' WHERE "Key" IN ('Sanitaer', 'Endmontage') AND lower("Color") = '#2a9cad';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "Activities" SET "Color" = '#2a9cad' WHERE "Key" IN ('Sanitaer', 'Endmontage') AND lower("Color") = '#0f6378';
                UPDATE "Activities" SET "Color" = '#d6c7bc' WHERE "Key" = 'Trockenbau' AND lower("Color") = '#e9dccb';
                UPDATE "Activities" SET "Color" = '#7a3e8e' WHERE "Key" = 'Fliesen' AND lower("Color") = '#86698a';
                UPDATE "Activities" SET "Color" = '#ff9f50' WHERE "Key" = 'RenoDeco' AND lower("Color") = '#f07a2a';
                """);
        }
    }
}
