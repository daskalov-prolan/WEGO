using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <inheritdoc />
    public partial class SiteLocation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "GeocodedFor",
                table: "Sites",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Latitude",
                table: "Sites",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Longitude",
                table: "Sites",
                type: "double precision",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "GeocodedFor",
                table: "Sites");

            migrationBuilder.DropColumn(
                name: "Latitude",
                table: "Sites");

            migrationBuilder.DropColumn(
                name: "Longitude",
                table: "Sites");
        }
    }
}
