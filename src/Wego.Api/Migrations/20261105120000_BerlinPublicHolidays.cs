using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Wego.Api.Data;

#nullable disable

namespace Wego.Api.Migrations
{
    /// <summary>
    /// Enters the Berlin public holidays of 2026 to 2035 under Verwaltung, so that they are listed there and
    /// can be seen and removed like every other entry. A day that already has a Feiertag (e.g. from the
    /// import) is left as it is. Down keeps them: they cannot be told apart from those entered by hand.
    /// </summary>
    [DbContext(typeof(WegoDbContext))]
    [Migration("20261105120000_BerlinPublicHolidays")]
    public partial class BerlinPublicHolidays : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            for (var year = 2026; year <= 2035; year++)
            {
                foreach (var (date, name) in BerlinHolidays.Named(year))
                {
                    var day = date.ToString("yyyy-MM-dd");
                    migrationBuilder.Sql(
                        $"INSERT INTO \"SchoolHolidays\" (\"Name\", \"Kind\", \"StartDate\", \"EndDate\") " +
                        $"SELECT '{name}', 'Feiertag', DATE '{day}', DATE '{day}' " +
                        $"WHERE NOT EXISTS (SELECT 1 FROM \"SchoolHolidays\" WHERE \"Kind\" = 'Feiertag' " +
                        $"AND \"StartDate\" = DATE '{day}' AND \"EndDate\" = DATE '{day}');");
                }
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
