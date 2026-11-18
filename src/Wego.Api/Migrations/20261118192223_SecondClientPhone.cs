using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <inheritdoc />
    public partial class SecondClientPhone : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ClientPhone2",
                table: "Sites",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ClientPhone2",
                table: "Sites");
        }
    }
}
