using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <summary>
    /// The day the enquiry came in (Anfrage am). The sites there are got the day they were created (their first
    /// status); service calls have none.
    /// </summary>
    public partial class SiteRequestedOn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "RequestedOn",
                table: "Sites",
                type: "date",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "Sites" s SET "RequestedOn" = (
                    SELECT MIN(c."ChangedAt")::date FROM "SiteStatusChanges" c WHERE c."SiteId" = s."Id")
                WHERE NOT s."IsService";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RequestedOn",
                table: "Sites");
        }
    }
}
