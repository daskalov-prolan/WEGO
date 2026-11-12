using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <inheritdoc />
    public partial class SiteSalutation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Salutation",
                table: "Sites",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Salutation",
                table: "Sites");
        }
    }
}
