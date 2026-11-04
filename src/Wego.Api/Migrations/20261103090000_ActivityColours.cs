using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Wego.Api.Data;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <summary>
    /// Stronger colours for the activities, in tune with the header: the offer phase in light petrol, petrol
    /// and orange, Abriss in the red of the logo, the rest of the construction phase strong and clear
    /// (Endmontage as Sanitär, Trockenbau orange to stand apart from the yellow of Urlaub and Krank).
    /// Only colours still as first set are changed; one chosen under Verwaltung stays.
    /// </summary>
    [DbContext(typeof(WegoDbContext))]
    [Migration("20261103090000_ActivityColours")]
    public partial class ActivityColours : Migration
    {
        private static readonly (string Key, string Old, string New)[] Colours =
        [
            ("Besichtigung", "#5fd6cf", "#3aa6c0"),
            ("Objektauswahl", "#a1887f", "#0f6378"),
            ("Angebotsuebergabe", "#b5bd3a", "#e8590c"),
            ("Abriss", "#f46a6a", "#d71f27"),
            ("Trockenbau", "#ffc000", "#fd7e14"),
            ("Sanitaer", "#7db4f2", "#1c7ed6"),
            ("RenoDeco", "#c49be3", "#7048e8"),
            ("Fliesen", "#f472c9", "#d6336c"),
            ("Endmontage", "#3f51b5", "#1c7ed6"),
        ];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var (key, old, colour) in Colours)
                migrationBuilder.Sql($"UPDATE \"Activities\" SET \"Color\" = '{colour}' WHERE \"Key\" = '{key}' AND lower(\"Color\") = '{old}';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var (key, old, colour) in Colours)
                migrationBuilder.Sql($"UPDATE \"Activities\" SET \"Color\" = '{old}' WHERE \"Key\" = '{key}' AND lower(\"Color\") = '{colour}';");
        }
    }
}
