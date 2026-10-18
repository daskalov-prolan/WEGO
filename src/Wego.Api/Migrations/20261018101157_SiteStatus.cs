using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <inheritdoc />
    /// <summary>Status of the sites with a log of its changes; existing sites are in construction (Bauphase).</summary>
    public partial class SiteStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "Sites",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Bauphase");

            migrationBuilder.CreateTable(
                name: "SiteStatusChanges",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SiteId = table.Column<int>(type: "integer", nullable: false),
                    From = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    To = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ChangedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ChangedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteStatusChanges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SiteStatusChanges_Sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "Sites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SiteStatusChanges_SiteId_ChangedAt",
                table: "SiteStatusChanges",
                columns: new[] { "SiteId", "ChangedAt" });

            // Sites that exist already are jobs under way; the log starts with that status.
            migrationBuilder.Sql("""
                INSERT INTO "SiteStatusChanges" ("SiteId", "From", "To", "ChangedAt", "ChangedBy")
                SELECT "Id", NULL, "Status", now() AT TIME ZONE 'utc', 'Übernahme' FROM "Sites";
                """);        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SiteStatusChanges");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "Sites");
        }
    }
}
