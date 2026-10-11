using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Wego.Api.Tests;

public class PlanApiTests(WegoApiFactory factory) : IClassFixture<WegoApiFactory>
{
    private const int Year = 2026;

    [Fact]
    public async Task Health_is_reachable_without_login()
    {
        var response = await factory.CreateClient().GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Plan_requires_login()
    {
        var response = await factory.CreateClient().GetAsync($"/api/plan?year={Year}");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_with_wrong_password_is_rejected()
    {
        var response = await factory.CreateClient().PostAsJsonAsync("/api/auth/login",
            new { userName = WegoApiFactory.PlanerUserName, password = "wrong" });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Split_day_is_saved_and_counted_in_the_customer_report()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var employeeId = await CreateEmployeeAsync(planer, "Split Tester", null, null);

        var put = await planer.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-03-02", new object[]
        {
            new { type = "Baustelle", customerName = "Familie Schulze", startTime = "08:00:00", endTime = "10:00:00" },
            new { type = "Baustelle", customerName = "Familie Meier", startTime = "11:00:00", endTime = "13:00:00" },
            new { type = "Baustelle", customerName = "Familie Werner", startTime = "13:00:00", endTime = "16:00:00" },
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        // A second day at the same site, written differently: it must not create a second customer.
        await planer.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-03-03", new object[]
        {
            new { type = "Baustelle", customerName = "familie schulze" },
        });

        var plan = await planer.GetFromJsonAsync<JsonElement>($"/api/plan?year={Year}");
        var entries = plan.GetProperty("entries").EnumerateArray()
            .Where(e => e.GetProperty("employeeId").GetInt32() == employeeId).ToList();
        Assert.Equal(4, entries.Count);
        Assert.Equal(["Familie Schulze", "Familie Meier", "Familie Werner", "Familie Schulze"],
            entries.Select(e => e.GetProperty("customerName").GetString()));

        var schulzeId = entries[0].GetProperty("customerId").GetInt32();
        var report = await planer.GetFromJsonAsync<JsonElement>($"/api/reports/customers/{schulzeId}?year={Year}");
        Assert.Equal(2, report.GetProperty("totalDays").GetInt32());
        Assert.Equal(2.0, report.GetProperty("totalHours").GetDouble());
        Assert.Equal("Split Tester", report.GetProperty("employees")[0].GetProperty("name").GetString());

        var employeeReport = await planer.GetFromJsonAsync<JsonElement>(
            $"/api/reports/employees/{employeeId}?year={Year}");
        Assert.Equal(2, employeeReport.GetProperty("totalDays").GetInt32());
        Assert.Equal(3, employeeReport.GetProperty("customers").GetArrayLength());
    }

    [Fact]
    public async Task Overlapping_time_windows_are_rejected()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var employeeId = await CreateEmployeeAsync(planer, "Overlap Tester", null, null);

        var put = await planer.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-04-01", new object[]
        {
            new { type = "Baustelle", customerName = "A", startTime = "08:00:00", endTime = "10:00:00" },
            new { type = "Baustelle", customerName = "B", startTime = "09:00:00", endTime = "11:00:00" },
        });

        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
    }

    [Fact]
    public async Task Employee_without_planning_rights_can_read_but_not_change_the_plan()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var employeeId = await CreateEmployeeAsync(planer, "Leser", "leser", "leser-passwort");
        var reader = await LoginAsync("leser", "leser-passwort");

        Assert.Equal(HttpStatusCode.OK, (await reader.GetAsync($"/api/plan?year={Year}")).StatusCode);

        var put = await reader.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-05-04",
            new object[] { new { type = "Urlaub" } });
        Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.GetAsync("/api/employees")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.GetAsync($"/api/reports/vacation?year={Year}")).StatusCode);
    }

    [Fact]
    public async Task Vacation_balance_is_visible_only_to_planers_and_the_employee()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var annaId = await CreateEmployeeAsync(planer, "Anna", "anna", "anna-passwort");
        await CreateEmployeeAsync(planer, "Bernd", "bernd", "bernd-passwort");

        // Friday to Monday: the weekend in between does not use up vacation days.
        foreach (var day in new[] { "08-07", "08-08", "08-09", "08-10" })
        {
            await planer.PutAsJsonAsync($"/api/plan/{annaId}/{Year}-{day}", new object[] { new { type = "Urlaub" } });
        }
        await planer.PutAsJsonAsync($"/api/plan/{annaId}/{Year}-09-01", new object[] { new { type = "Krank" } });

        var url = $"/api/reports/employees/{annaId}?year={Year}";

        var forPlaner = (await planer.GetFromJsonAsync<JsonElement>(url)).GetProperty("vacation");
        Assert.Equal(30, forPlaner.GetProperty("entitlement").GetInt32());
        Assert.Equal(2, forPlaner.GetProperty("used").GetInt32());
        Assert.Equal(28, forPlaner.GetProperty("remaining").GetInt32());
        Assert.Equal(1, forPlaner.GetProperty("sickDays").GetInt32());

        var anna = await LoginAsync("anna", "anna-passwort");
        var forAnna = (await anna.GetFromJsonAsync<JsonElement>(url)).GetProperty("vacation");
        Assert.Equal(28, forAnna.GetProperty("remaining").GetInt32());

        var bernd = await LoginAsync("bernd", "bernd-passwort");
        var forBernd = (await bernd.GetFromJsonAsync<JsonElement>(url)).GetProperty("vacation");
        Assert.Equal(JsonValueKind.Null, forBernd.ValueKind);
    }

    [Fact]
    public async Task Deactivated_employee_is_signed_out_immediately()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var id = await CreateEmployeeAsync(planer, "Ehemalig", "ehemalig", "ehemalig-passwort");
        var former = await LoginAsync("ehemalig", "ehemalig-passwort");

        var update = await planer.PutAsJsonAsync($"/api/employees/{id}", new
        {
            name = "Ehemalig", sortOrder = 0, isActive = false, showInPlan = true, vacationDaysPerYear = 30,
            userName = "ehemalig", role = "Mitarbeiter", password = (string?)null,
        });
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await former.GetAsync($"/api/plan?year={Year}")).StatusCode);
    }

    [Fact]
    public async Task Site_details_are_kept_and_survive_merging_two_spellings()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var employeeId = await CreateEmployeeAsync(planer, "Stammdaten Tester", null, null);
        await planer.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-06-01",
            new object[] { new { type = "Baustelle", customerName = "Samarrai" } });
        await planer.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-06-02",
            new object[] { new { type = "Baustelle", customerName = "Sammarai" } });

        var customers = await planer.GetFromJsonAsync<JsonElement>("/api/customers");
        int IdOf(string name) => customers.EnumerateArray()
            .Single(c => c.GetProperty("name").GetString() == name).GetProperty("id").GetInt32();

        var update = await planer.PutAsJsonAsync($"/api/customers/{IdOf("Samarrai")}",
            new { name = "Samarrai", location = "13125 Karow", description = "Komplettbad" });
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);

        // Renaming the misspelt one to the correct name merges both.
        var merged = await (await planer.PutAsJsonAsync($"/api/customers/{IdOf("Sammarai")}",
            new { name = "Samarrai", location = (string?)null, description = "sollte nicht überschreiben" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(IdOf("Samarrai"), merged.GetProperty("id").GetInt32());
        Assert.Equal("13125 Karow", merged.GetProperty("location").GetString());
        Assert.Equal("Komplettbad", merged.GetProperty("description").GetString());

        var report = await planer.GetFromJsonAsync<JsonElement>(
            $"/api/reports/customers/{IdOf("Samarrai")}?year={Year}");
        Assert.Equal(2, report.GetProperty("totalDays").GetInt32());
    }

    [Fact]
    public async Task Generated_access_lets_the_employee_sign_in_and_asks_for_an_own_password()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var id = await CreateEmployeeAsync(planer, "Jörg Müßig", null, null);

        var access = await (await planer.PostAsync($"/api/employees/{id}/access", null))
            .Content.ReadFromJsonAsync<JsonElement>();
        var userName = access.GetProperty("userName").GetString()!;
        var initialPassword = access.GetProperty("initialPassword").GetString()!;
        Assert.Equal("joerg.muessig", userName);

        var employee = await LoginAsync(userName, initialPassword);
        var me = await employee.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.True(me.GetProperty("mustChangePassword").GetBoolean());
        Assert.True(me.GetProperty("showInPlan").GetBoolean());

        var change = await employee.PostAsJsonAsync("/api/auth/password",
            new { currentPassword = initialPassword, newPassword = "mein-eigenes-passwort" });
        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);

        me = await employee.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.False(me.GetProperty("mustChangePassword").GetBoolean());
        await LoginAsync(userName, "mein-eigenes-passwort");

        // A second employee with the same name gets a different user name.
        var secondId = await CreateEmployeeAsync(planer, "Jörg Müßig", null, null);
        var second = await (await planer.PostAsync($"/api/employees/{secondId}/access", null))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("joerg.muessig2", second.GetProperty("userName").GetString());
    }

    private async Task<HttpClient> LoginAsync(string userName, string password)
    {
        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/login", new { userName, password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return client;
    }

    private static async Task<int> CreateEmployeeAsync(HttpClient planer, string name, string? userName,
        string? password)
    {
        var response = await planer.PostAsJsonAsync("/api/employees", new
        {
            name, sortOrder = 0, isActive = true, showInPlan = true, vacationDaysPerYear = 30,
            userName, role = "Mitarbeiter", password,
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }
}
