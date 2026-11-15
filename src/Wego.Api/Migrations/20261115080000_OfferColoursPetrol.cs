using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Wego.Api.Data;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <summary>
    /// The offer phase in the petrol of the company, from dark to light, the Angebotsübergabe in orange: Anfrage
    /// Tiefpetrol, Besichtigung Petrol, Objektauswahl Helltürkis, Angebotsübergabe Orange. Only colours not changed
    /// under Verwaltung.
    /// </summary>
    [DbContext(typeof(WegoDbContext))]
    [Migration("20261115080000_OfferColoursPetrol")]
    public partial class OfferColoursPetrol : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "Activities" SET "Color" = '#0b4a5e' WHERE "Key" = 'Anfrage' AND lower("Color") = '#b8a47a';
                UPDATE "Activities" SET "Color" = '#0f6378' WHERE "Key" = 'Besichtigung' AND lower("Color") = '#3aa6c0';
                UPDATE "Activities" SET "Color" = '#5fb3c6' WHERE "Key" = 'Objektauswahl' AND lower("Color") = '#0f6378';
                UPDATE "Activities" SET "Color" = '#f07a2a' WHERE "Key" = 'Angebotsuebergabe' AND lower("Color") = '#c77f6b';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "Activities" SET "Color" = '#c77f6b' WHERE "Key" = 'Angebotsuebergabe' AND lower("Color") = '#f07a2a';
                UPDATE "Activities" SET "Color" = '#0f6378' WHERE "Key" = 'Objektauswahl' AND lower("Color") = '#5fb3c6';
                UPDATE "Activities" SET "Color" = '#3aa6c0' WHERE "Key" = 'Besichtigung' AND lower("Color") = '#0f6378';
                UPDATE "Activities" SET "Color" = '#b8a47a' WHERE "Key" = 'Anfrage' AND lower("Color") = '#0b4a5e';
                """);
        }
    }
}
