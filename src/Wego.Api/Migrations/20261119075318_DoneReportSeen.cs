using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <inheritdoc />
    public partial class DoneReportSeen : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ReportSeenAt",
                table: "SiteStatusChanges",
                type: "timestamp with time zone",
                nullable: true);

            // Sites done before: seen already, nothing to tell Planer G about them.
            migrationBuilder.Sql("UPDATE \"SiteStatusChanges\" SET \"ReportSeenAt\" = \"ChangedAt\"");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ReportSeenAt",
                table: "SiteStatusChanges");
        }
    }
}
