using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <inheritdoc />
    public partial class EntryNoteImportant : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "NoteImportant",
                table: "PlanEntries",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "NoteImportant",
                table: "PlanEntries");
        }
    }
}
