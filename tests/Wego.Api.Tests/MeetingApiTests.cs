using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Wego.Api.Tests;

// One test database for all: the classes run one after the other.
[Collection("Database")]
public class MeetingApiTests(WegoApiFactory factory) : IClassFixture<WegoApiFactory>
{
    [Fact]
    public async Task A_weekly_meeting_is_in_the_plans_of_its_participants_and_a_week_can_be_cancelled_or_moved()
    {
        var g = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var a = await CreateEmployeeAsync(g, "Runde A", "runde.a", "runde-a-pw");
        var b = await CreateEmployeeAsync(g, "Runde B", null, null);
        var craftsman = await LoginAsync("runde.a", "runde-a-pw");

        // The first Wednesday in two weeks, and the three after it.
        var start = DateOnly.FromDateTime(DateTime.Today).AddDays(14);
        while (start.DayOfWeek != DayOfWeek.Wednesday) start = start.AddDays(1);
        var input = new
        {
            title = "Bauberatung", weekday = 3, startTime = "09:00", endTime = "10:30",
            startsOn = start.ToString("yyyy-MM-dd"), endsOn = start.AddDays(21).ToString("yyyy-MM-dd"), participantIds = new[] { a, b },
        };

        // Only planners keep the meetings.
        Assert.Equal(HttpStatusCode.Forbidden, (await craftsman.PostAsJsonAsync("/api/meetings", input)).StatusCode);
        // The end before the start, or nobody taking part: refused.
        Assert.Equal(HttpStatusCode.BadRequest, (await g.PostAsJsonAsync("/api/meetings", input with { endTime = "08:00" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await g.PostAsJsonAsync("/api/meetings", input with { participantIds = Array.Empty<int>() })).StatusCode);
        var created = await g.PostAsJsonAsync("/api/meetings", input);
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        async Task<List<JsonElement>> WeeksAsync()
        {
            var weeks = new List<JsonElement>();
            for (var year = start.Year; year <= start.AddDays(28).Year; year++)
            {
                var plan = await craftsman.GetFromJsonAsync<JsonElement>($"/api/plan?year={year}");
                weeks.AddRange(plan.GetProperty("meetings").EnumerateArray().Where(m => m.GetProperty("meetingId").GetInt32() == id));
            }
            return weeks;
        }

        // Every Wednesday of the series (but on a public holiday), with both, from 9:00 to 10:30.
        var weeks = await WeeksAsync();
        Assert.InRange(weeks.Count, 3, 4);
        Assert.All(weeks, w =>
        {
            Assert.Equal(DayOfWeek.Wednesday, DateOnly.Parse(w.GetProperty("date").GetString()!).DayOfWeek);
            Assert.Equal("09:00:00", w.GetProperty("startTime").GetString());
            Assert.Equal(new[] { a, b }.Order(), w.GetProperty("employeeIds").EnumerateArray().Select(e => e.GetInt32()).Order());
        });

        // One week cancelled, another moved to the Thursday at 11:00; then the cancelled one as in the series again.
        var first = weeks[0].GetProperty("date").GetString()!;
        var second = weeks[1].GetProperty("date").GetString()!;
        var thursday = DateOnly.Parse(second).AddDays(1).ToString("yyyy-MM-dd");
        Assert.Equal(HttpStatusCode.OK, (await g.PostAsJsonAsync($"/api/meetings/{id}/changes", new { date = first, cancelled = true })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await g.PostAsJsonAsync($"/api/meetings/{id}/changes",
            new { date = second, cancelled = false, newDate = thursday, newStartTime = "11:00", newEndTime = "12:30" })).StatusCode);
        // Not a day of the series: refused.
        Assert.Equal(HttpStatusCode.BadRequest, (await g.PostAsJsonAsync($"/api/meetings/{id}/changes",
            new { date = thursday, cancelled = true })).StatusCode);

        weeks = await WeeksAsync();
        Assert.DoesNotContain(weeks, w => w.GetProperty("date").GetString() == first);
        var moved = weeks.Single(w => w.GetProperty("originalDate").GetString() == second);
        Assert.Equal((thursday, "11:00:00", true), (moved.GetProperty("date").GetString(), moved.GetProperty("startTime").GetString(), moved.GetProperty("moved").GetBoolean()));

        Assert.Equal(HttpStatusCode.OK, (await g.DeleteAsync($"/api/meetings/{id}/changes?date={first}")).StatusCode);
        Assert.Contains(await WeeksAsync(), w => w.GetProperty("date").GetString() == first);

        // The craftsman cannot come the first week: he asks; a planner (not taking part) cannot ask for himself.
        Assert.Equal(HttpStatusCode.Forbidden, (await g.PostAsJsonAsync($"/api/meetings/{id}/absences", new { date = first, reason = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await craftsman.PostAsJsonAsync($"/api/meetings/{id}/absences", new { date = first, reason = "Baustelle" })).StatusCode);
        var asked = (await WeeksAsync()).Single(w => w.GetProperty("date").GetString() == first);
        Assert.Equal(new[] { a }, asked.GetProperty("requested").EnumerateArray().Select(e => e.GetInt32()));
        Assert.Equal("Runde A", asked.GetProperty("names").GetProperty(a.ToString()).GetString());
        // Planer G sees the request and lets him off: the week stays for B only; he cannot decide himself.
        var requests = await g.GetFromJsonAsync<JsonElement>("/api/meetings/requests");
        Assert.Contains(requests.EnumerateArray(), r => r.GetProperty("employeeId").GetInt32() == a && r.GetProperty("date").GetString() == first);
        Assert.Equal(HttpStatusCode.Forbidden, (await craftsman.PostAsJsonAsync($"/api/meetings/{id}/absences/decide",
            new { date = first, employeeId = a, approve = true })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await g.PostAsJsonAsync($"/api/meetings/{id}/absences/decide",
            new { date = first, employeeId = a, approve = true })).StatusCode);
        var letOff = (await WeeksAsync()).Single(w => w.GetProperty("date").GetString() == first);
        Assert.Equal(new[] { b }, letOff.GetProperty("employeeIds").EnumerateArray().Select(e => e.GetInt32()));
        Assert.Empty(letOff.GetProperty("requested").EnumerateArray());

        // The series goes; nothing is left of it.
        Assert.Equal(HttpStatusCode.NoContent, (await g.DeleteAsync($"/api/meetings/{id}")).StatusCode);
        Assert.Empty(await WeeksAsync());
    }

    private async Task<HttpClient> LoginAsync(string userName, string password)
    {
        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/login", new { userName, password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return client;
    }

    private static async Task<int> CreateEmployeeAsync(HttpClient planer, string name, string? userName, string? password)
    {
        var response = await planer.PostAsJsonAsync("/api/employees", new
        {
            name, sortOrder = 0, isActive = true, showInPlan = true, vacationDaysPerYear = 30, userName, role = "Handwerker", password,
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }
}
