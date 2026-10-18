using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <summary>
    /// Customers become construction sites (Baustellen) with client and address. The existing records and
    /// the plan entries pointing at them are kept: the old name becomes the client (Auftraggeber), the old
    /// place ("13467 RD", "Karow") is split into postal code and city.
    /// </summary>
    public partial class ConstructionSites : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_PlanEntries_Customers_CustomerId", table: "PlanEntries");
            migrationBuilder.DropIndex(name: "IX_Customers_Name", table: "Customers");

            migrationBuilder.RenameTable(name: "Customers", newName: "Sites");
            migrationBuilder.Sql("ALTER TABLE \"Sites\" RENAME CONSTRAINT \"PK_Customers\" TO \"PK_Sites\";");
            migrationBuilder.RenameColumn(name: "CustomerId", table: "PlanEntries", newName: "SiteId");
            migrationBuilder.RenameIndex(name: "IX_PlanEntries_CustomerId_Date", table: "PlanEntries",
                newName: "IX_PlanEntries_SiteId_Date");

            migrationBuilder.AlterColumn<string>(name: "Name", table: "Sites", type: "character varying(220)",
                maxLength: 220, nullable: false, oldClrType: typeof(string), oldType: "character varying(200)",
                oldMaxLength: 200);

            migrationBuilder.AddColumn<string>(name: "Client", table: "Sites", type: "character varying(200)",
                maxLength: 200, nullable: true);
            migrationBuilder.AddColumn<string>(name: "Street", table: "Sites", type: "character varying(200)",
                maxLength: 200, nullable: true);
            migrationBuilder.AddColumn<string>(name: "HouseNumber", table: "Sites", type: "character varying(20)",
                maxLength: 20, nullable: true);
            migrationBuilder.AddColumn<string>(name: "AddressAddition", table: "Sites",
                type: "character varying(200)", maxLength: 200, nullable: true);
            migrationBuilder.AddColumn<string>(name: "PostalCode", table: "Sites", type: "character varying(10)",
                maxLength: 10, nullable: true);
            migrationBuilder.AddColumn<string>(name: "City", table: "Sites", type: "character varying(100)",
                maxLength: 100, nullable: true);
            migrationBuilder.AddColumn<string>(name: "NameSource", table: "Sites", type: "character varying(20)",
                maxLength: 20, nullable: false, defaultValue: "Auftraggeber");

            migrationBuilder.Sql("UPDATE \"Sites\" SET \"Client\" = \"Name\";");
            migrationBuilder.Sql("""
                UPDATE "Sites"
                SET "PostalCode" = substring("Location" from '^(\d{5})'),
                    "City" = nullif(trim(regexp_replace("Location", '^\d{5}\s*', '')), '')
                WHERE "Location" IS NOT NULL;
                """);
            migrationBuilder.DropColumn(name: "Location", table: "Sites");

            migrationBuilder.CreateIndex(name: "IX_Sites_Name", table: "Sites", column: "Name");
            migrationBuilder.AddForeignKey(name: "FK_PlanEntries_Sites_SiteId", table: "PlanEntries",
                column: "SiteId", principalTable: "Sites", principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_PlanEntries_Sites_SiteId", table: "PlanEntries");
            migrationBuilder.DropIndex(name: "IX_Sites_Name", table: "Sites");

            migrationBuilder.AddColumn<string>(name: "Location", table: "Sites", type: "character varying(200)",
                maxLength: 200, nullable: true);
            migrationBuilder.Sql("""
                UPDATE "Sites"
                SET "Location" = nullif(trim(concat_ws(' ', concat_ws(' ', "Street", "HouseNumber"), "PostalCode", "City")), '');
                """);
            foreach (var column in new[] { "Client", "Street", "HouseNumber", "AddressAddition", "PostalCode", "City", "NameSource" })
                migrationBuilder.DropColumn(name: column, table: "Sites");

            migrationBuilder.AlterColumn<string>(name: "Name", table: "Sites", type: "character varying(200)",
                maxLength: 200, nullable: false, oldClrType: typeof(string), oldType: "character varying(220)",
                oldMaxLength: 220);

            migrationBuilder.RenameIndex(name: "IX_PlanEntries_SiteId_Date", table: "PlanEntries",
                newName: "IX_PlanEntries_CustomerId_Date");
            migrationBuilder.RenameColumn(name: "SiteId", table: "PlanEntries", newName: "CustomerId");
            migrationBuilder.Sql("ALTER TABLE \"Sites\" RENAME CONSTRAINT \"PK_Sites\" TO \"PK_Customers\";");
            migrationBuilder.RenameTable(name: "Sites", newName: "Customers");

            // Two sites with the same client would break the old unique names: the later ones get their id added.
            migrationBuilder.Sql("""
                UPDATE "Customers" c SET "Name" = c."Name" || ' (' || c."Id" || ')'
                WHERE EXISTS (SELECT 1 FROM "Customers" o WHERE o."Name" = c."Name" AND o."Id" < c."Id");
                """);
            migrationBuilder.CreateIndex(name: "IX_Customers_Name", table: "Customers", column: "Name", unique: true);
            migrationBuilder.AddForeignKey(name: "FK_PlanEntries_Customers_CustomerId", table: "PlanEntries",
                column: "CustomerId", principalTable: "Customers", principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}