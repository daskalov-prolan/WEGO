using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <inheritdoc />
    public partial class ActivitiesAndRoles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "AdditionalActivities",
                table: "Employees",
                type: "character varying(400)",
                maxLength: 400,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200);

            migrationBuilder.CreateTable(
                name: "Activities",
                columns: table => new
                {
                    Key = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Phase = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    Color = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Activities", x => x.Key);
                });

            // The activities that were built in so far, with their colours from the plan. In the offer phase
            // Angebotskalkulation becomes Objektauswahl and Angebotsbesprechung becomes Angebotsübergabe.
            migrationBuilder.InsertData(
                table: "Activities",
                columns: ["Key", "Label", "Phase", "SortOrder", "Color"],
                values: new object[,]
                {
                    { "Besichtigung", "Besichtigung", "Angebot", 1, "#5fd6cf" },
                    { "Objektauswahl", "Objektauswahl", "Angebot", 2, "#a1887f" },
                    { "Angebotsuebergabe", "Angebotsübergabe", "Angebot", 3, "#b5bd3a" },
                    { "Abriss", "Abriss / Baubeginn", "Bauphase", 4, "#f46a6a" },
                    { "Trockenbau", "Trockenbau", "Bauphase", 5, "#ffc000" },
                    { "Sanitaer", "Sanitär", "Bauphase", 6, "#7db4f2" },
                    { "RenoDeco", "RenoDeco-Platten", "Bauphase", 7, "#c49be3" },
                    { "Fliesen", "Fliesenarbeiten", "Bauphase", 8, "#f472c9" },
                    { "Endmontage", "Endmontage", "Bauphase", 9, "#3f51b5" },
                });

            foreach (var (from, to) in new[] { ("Angebotskalkulation", "Objektauswahl"), ("Angebotsbesprechung", "Angebotsuebergabe") })
            {
                migrationBuilder.Sql($"""UPDATE "PlanEntries" SET "Activity" = '{to}' WHERE "Activity" = '{from}';""");
                migrationBuilder.Sql($"""UPDATE "SiteTasks" SET "Activity" = '{to}' WHERE "Activity" = '{from}';""");
                migrationBuilder.Sql($"""UPDATE "Employees" SET "MainActivity" = '{to}' WHERE "MainActivity" = '{from}';""");
                migrationBuilder.Sql($"""UPDATE "Employees" SET "AdditionalActivities" = replace("AdditionalActivities", '{from}', '{to}');""");
            }

            // Mitarbeiter become Handwerker, Planer become Planer A; marina and planer (or else the oldest
            // planner) Planer G.
            migrationBuilder.Sql("""UPDATE "Employees" SET "Role" = 'Handwerker' WHERE "Role" = 'Mitarbeiter';""");
            migrationBuilder.Sql("""UPDATE "Employees" SET "Role" = 'PlanerA' WHERE "Role" = 'Planer';""");
            migrationBuilder.Sql("""UPDATE "Employees" SET "Role" = 'PlanerG' WHERE "UserName" IN ('marina', 'planer');""");
            migrationBuilder.Sql("""
                UPDATE "Employees" SET "Role" = 'PlanerG'
                WHERE NOT EXISTS (SELECT 1 FROM "Employees" WHERE "Role" = 'PlanerG')
                  AND "Id" = (SELECT MIN("Id") FROM "Employees" WHERE "Role" = 'PlanerA');
                """);

            migrationBuilder.CreateIndex(
                name: "IX_SiteTasks_Activity",
                table: "SiteTasks",
                column: "Activity");

            migrationBuilder.CreateIndex(
                name: "IX_PlanEntries_Activity",
                table: "PlanEntries",
                column: "Activity");

            migrationBuilder.CreateIndex(
                name: "IX_Employees_MainActivity",
                table: "Employees",
                column: "MainActivity");

            migrationBuilder.AddForeignKey(
                name: "FK_Employees_Activities_MainActivity",
                table: "Employees",
                column: "MainActivity",
                principalTable: "Activities",
                principalColumn: "Key",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_PlanEntries_Activities_Activity",
                table: "PlanEntries",
                column: "Activity",
                principalTable: "Activities",
                principalColumn: "Key",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_SiteTasks_Activities_Activity",
                table: "SiteTasks",
                column: "Activity",
                principalTable: "Activities",
                principalColumn: "Key",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Employees_Activities_MainActivity",
                table: "Employees");

            migrationBuilder.DropForeignKey(
                name: "FK_PlanEntries_Activities_Activity",
                table: "PlanEntries");

            migrationBuilder.DropForeignKey(
                name: "FK_SiteTasks_Activities_Activity",
                table: "SiteTasks");

            migrationBuilder.Sql("""UPDATE "Employees" SET "Role" = 'Mitarbeiter' WHERE "Role" = 'Handwerker';""");
            migrationBuilder.Sql("""UPDATE "Employees" SET "Role" = 'Planer' WHERE "Role" IN ('PlanerA', 'PlanerG');""");
            foreach (var (from, to) in new[] { ("Objektauswahl", "Angebotskalkulation"), ("Angebotsuebergabe", "Angebotsbesprechung") })
            {
                migrationBuilder.Sql($"""UPDATE "PlanEntries" SET "Activity" = '{to}' WHERE "Activity" = '{from}';""");
                migrationBuilder.Sql($"""UPDATE "SiteTasks" SET "Activity" = '{to}' WHERE "Activity" = '{from}';""");
                migrationBuilder.Sql($"""UPDATE "Employees" SET "MainActivity" = '{to}' WHERE "MainActivity" = '{from}';""");
                migrationBuilder.Sql($"""UPDATE "Employees" SET "AdditionalActivities" = replace("AdditionalActivities", '{from}', '{to}');""");
            }

            migrationBuilder.DropTable(
                name: "Activities");

            migrationBuilder.DropIndex(
                name: "IX_SiteTasks_Activity",
                table: "SiteTasks");

            migrationBuilder.DropIndex(
                name: "IX_PlanEntries_Activity",
                table: "PlanEntries");

            migrationBuilder.DropIndex(
                name: "IX_Employees_MainActivity",
                table: "Employees");

            migrationBuilder.AlterColumn<string>(
                name: "AdditionalActivities",
                table: "Employees",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(400)",
                oldMaxLength: 400);
        }
    }
}
