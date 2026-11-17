using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <inheritdoc />
    public partial class OwnCalendars : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CalendarToken",
                table: "Employees",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExternalCalendarError",
                table: "Employees",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ExternalCalendarSyncedAt",
                table: "Employees",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExternalCalendarUrl",
                table: "Employees",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ExternalBusy",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    EmployeeId = table.Column<int>(type: "integer", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    StartTime = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    EndTime = table.Column<TimeOnly>(type: "time without time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExternalBusy", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ExternalBusy_Employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "Employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Employees_CalendarToken",
                table: "Employees",
                column: "CalendarToken",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExternalBusy_EmployeeId_Date",
                table: "ExternalBusy",
                columns: new[] { "EmployeeId", "Date" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ExternalBusy");

            migrationBuilder.DropIndex(
                name: "IX_Employees_CalendarToken",
                table: "Employees");

            migrationBuilder.DropColumn(
                name: "CalendarToken",
                table: "Employees");

            migrationBuilder.DropColumn(
                name: "ExternalCalendarError",
                table: "Employees");

            migrationBuilder.DropColumn(
                name: "ExternalCalendarSyncedAt",
                table: "Employees");

            migrationBuilder.DropColumn(
                name: "ExternalCalendarUrl",
                table: "Employees");
        }
    }
}
