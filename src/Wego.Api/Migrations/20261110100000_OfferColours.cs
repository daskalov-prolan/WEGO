using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Wego.Api.Data;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <summary>
    /// The terracotta was meant for Angebotsübergabe: Objektauswahl keeps its petrol (see ActivityAnfrage), and
    /// Angebotsübergabe takes the terracotta in place of its orange. Only colours not changed under Verwaltung.
    /// </summary>
    [DbContext(typeof(WegoDbContext))]
    [Migration("20261110100000_OfferColours")]
    public partial class OfferColours : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "Activities" SET "Color" = '#0f6378' WHERE "Key" = 'Objektauswahl' AND lower("Color") = '#c77f6b';
                UPDATE "Activities" SET "Color" = '#c77f6b' WHERE "Key" = 'Angebotsuebergabe' AND lower("Color") = '#e8590c';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "Activities" SET "Color" = '#e8590c' WHERE "Key" = 'Angebotsuebergabe' AND lower("Color") = '#c77f6b';
                """);
        }
    }
}
