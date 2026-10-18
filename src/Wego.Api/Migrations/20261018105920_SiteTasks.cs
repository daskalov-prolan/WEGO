using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <inheritdoc />
    /// <summary>The activities each site needs in its status, with estimated employee days.</summary>
    public partial class SiteTasks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SiteTasks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SiteId = table.Column<int>(type: "integer", nullable: false),
                    Activity = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    EstimatedDays = table.Column<int>(type: "integer", nullable: false),
                    NotNeeded = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteTasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SiteTasks_Sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "Sites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SiteTasks_SiteId_Activity",
                table: "SiteTasks",
                columns: new[] { "SiteId", "Activity" },
                unique: true);

            // The open sites get the activities of their current status right away.
            migrationBuilder.Sql("""
                INSERT INTO "SiteTasks" ("SiteId", "Activity", "EstimatedDays", "NotNeeded")
                SELECT s."Id", a.activity, 1, false
                FROM "Sites" s
                JOIN (VALUES
                    ('Angebot', 'Besichtigung'), ('Angebot', 'Angebotskalkulation'), ('Angebot', 'Angebotsbesprechung'),
                    ('Bauphase', 'Abriss'), ('Bauphase', 'Trockenbau'), ('Bauphase', 'Sanitaer'),
                    ('Bauphase', 'RenoDeco'), ('Bauphase', 'Fliesen'), ('Bauphase', 'Endmontage')
                ) AS a(status, activity) ON a.status = s."Status";
                """);        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SiteTasks");
        }
    }
}
