using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Wego.Api.Data;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <summary>
    /// The colours of the construction phase as the planners chose them in November 2026: Trockenbau light greige,
    /// Abriss / Baubeginn signal red, Sanitär and Endmontage light turquoise, Fliesen blackberry, RenoDeco apricot.
    /// Set for every database, whatever colour was chosen before (Down gives back the previous standard).
    /// </summary>
    [DbContext(typeof(WegoDbContext))]
    [Migration("20261105090000_ActivityColoursNovember")]
    public partial class ActivityColoursNovember : Migration
    {
        private static readonly (string Key, string Old, string New)[] Colours =
        [
            ("Trockenbau", "#fd7e14", "#d6c7bc"),
            ("Abriss", "#d71f27", "#e31b35"),
            ("Sanitaer", "#1c7ed6", "#2a9cad"),
            ("Endmontage", "#1c7ed6", "#2a9cad"),
            ("Fliesen", "#d6336c", "#7a3e8e"),
            ("RenoDeco", "#7048e8", "#ff9f50"),
        ];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var (key, _, colour) in Colours)
                migrationBuilder.Sql($"UPDATE \"Activities\" SET \"Color\" = '{colour}' WHERE \"Key\" = '{key}';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var (key, old, colour) in Colours)
                migrationBuilder.Sql($"UPDATE \"Activities\" SET \"Color\" = '{old}' WHERE \"Key\" = '{key}' AND lower(\"Color\") = '{colour}';");
        }
    }
}
