using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <inheritdoc />
    public partial class SiteResponsiblePlanner : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ResponsiblePlannerId",
                table: "Sites",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Sites_ResponsiblePlannerId",
                table: "Sites",
                column: "ResponsiblePlannerId");

            migrationBuilder.AddForeignKey(
                name: "FK_Sites_Employees_ResponsiblePlannerId",
                table: "Sites",
                column: "ResponsiblePlannerId",
                principalTable: "Employees",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Sites_Employees_ResponsiblePlannerId",
                table: "Sites");

            migrationBuilder.DropIndex(
                name: "IX_Sites_ResponsiblePlannerId",
                table: "Sites");

            migrationBuilder.DropColumn(
                name: "ResponsiblePlannerId",
                table: "Sites");
        }
    }
}
