using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <inheritdoc />
    public partial class SeveralOwnCalendars : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ExternalCalendars",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    EmployeeId = table.Column<int>(type: "integer", nullable: false),
                    Url = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    SyncedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Error = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExternalCalendars", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ExternalCalendars_Employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "Employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddColumn<int>(
                name: "CalendarId",
                table: "ExternalBusy",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // The one calendar each had so far becomes his first; its busy times stay with it, others (none) go.
            migrationBuilder.Sql("""
                INSERT INTO "ExternalCalendars" ("EmployeeId", "Url", "SyncedAt", "Error")
                SELECT "Id", "ExternalCalendarUrl", "ExternalCalendarSyncedAt", "ExternalCalendarError" FROM "Employees"
                WHERE "ExternalCalendarUrl" IS NOT NULL;
                UPDATE "ExternalBusy" b SET "CalendarId" = c."Id" FROM "ExternalCalendars" c WHERE c."EmployeeId" = b."EmployeeId";
                DELETE FROM "ExternalBusy" WHERE "CalendarId" = 0;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_ExternalBusy_CalendarId",
                table: "ExternalBusy",
                column: "CalendarId");

            migrationBuilder.CreateIndex(
                name: "IX_ExternalCalendars_EmployeeId",
                table: "ExternalCalendars",
                column: "EmployeeId");

            migrationBuilder.AddForeignKey(
                name: "FK_ExternalBusy_ExternalCalendars_CalendarId",
                table: "ExternalBusy",
                column: "CalendarId",
                principalTable: "ExternalCalendars",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ExternalBusy_ExternalCalendars_CalendarId",
                table: "ExternalBusy");

            migrationBuilder.DropTable(
                name: "ExternalCalendars");

            migrationBuilder.DropIndex(
                name: "IX_ExternalBusy_CalendarId",
                table: "ExternalBusy");

            migrationBuilder.DropColumn(
                name: "CalendarId",
                table: "ExternalBusy");

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
        }
    }
}
