using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <inheritdoc />
    public partial class DeclineStepAndReport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DeclineStep",
                table: "Sites",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ReportedDeclineAt",
                table: "Sites",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReportedDeclineBy",
                table: "Sites",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReportedDeclineNote",
                table: "Sites",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReportedDeclineReason",
                table: "Sites",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DeclineStep",
                table: "Sites");

            migrationBuilder.DropColumn(
                name: "ReportedDeclineAt",
                table: "Sites");

            migrationBuilder.DropColumn(
                name: "ReportedDeclineBy",
                table: "Sites");

            migrationBuilder.DropColumn(
                name: "ReportedDeclineNote",
                table: "Sites");

            migrationBuilder.DropColumn(
                name: "ReportedDeclineReason",
                table: "Sites");
        }
    }
}
