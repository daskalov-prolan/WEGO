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
    public async Task Split_day_is_saved_and_counted_in_the_site_report()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var employeeId = await CreateEmployeeAsync(planer, "Split Tester", null, null);
        var schulze = await CreateSiteAsync(planer, "Familie Schulze");
        var meier = await CreateSiteAsync(planer, "Familie Meier");
        var werner = await CreateSiteAsync(planer, "Familie Werner");

        var put = await planer.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-03-02", new object[]
        {
            new { type = "Baustelle", siteId = schulze, startTime = "08:00:00", endTime = "10:00:00" },
            new { type = "Baustelle", siteId = meier, startTime = "11:00:00", endTime = "13:00:00" },
            new { type = "Baustelle", siteId = werner, startTime = "13:00:00", endTime = "16:00:00" },
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        await planer.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-03-03", new object[]
        {
            new { type = "Baustelle", siteId = schulze },
        });

        var plan = await planer.GetFromJsonAsync<JsonElement>($"/api/plan?year={Year}");
        var entries = plan.GetProperty("entries").EnumerateArray()
            .Where(e => e.GetProperty("employeeId").GetInt32() == employeeId).ToList();
        Assert.Equal(4, entries.Count);
        Assert.Equal(["Familie Schulze", "Familie Meier", "Familie Werner", "Familie Schulze"],
            entries.Select(e => e.GetProperty("siteName").GetString()));

        var report = await planer.GetFromJsonAsync<JsonElement>($"/api/reports/sites/{schulze}?year={Year}");
        Assert.Equal(2, report.GetProperty("totalDays").GetInt32());
        Assert.Equal(2.0, report.GetProperty("totalHours").GetDouble());
        Assert.Equal("Split Tester", report.GetProperty("employees")[0].GetProperty("name").GetString());

        var employeeReport = await planer.GetFromJsonAsync<JsonElement>(
            $"/api/reports/employees/{employeeId}?year={Year}");
        Assert.Equal(2, employeeReport.GetProperty("totalDays").GetInt32());
        Assert.Equal(3, employeeReport.GetProperty("sites").GetArrayLength());
    }

    [Fact]
    public async Task Batch_saves_several_days_at_once_or_none_of_them()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var a = await CreateEmployeeAsync(planer, "Batch A", null, null);
        var b = await CreateEmployeeAsync(planer, "Batch B", null, null);

        var siteId = await CreateSiteAsync(planer, "Familie Batch");
        var site = new object[] { new { type = "Baustelle", siteId, activity = "Fliesen", note = "Schlüssel beim Hausmeister", noteImportant = true } };
        var saved = await planer.PutAsJsonAsync("/api/plan/batch", new object[]
        {
            new { employeeId = a, date = $"{Year}-07-06", entries = site },
            new { employeeId = a, date = $"{Year}-07-07", entries = site },
            new { employeeId = b, date = $"{Year}-07-06", entries = new object[] { new { type = "Urlaub" } } },
        });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var savedEntries = await saved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(3, savedEntries.GetArrayLength());
        Assert.All(savedEntries.EnumerateArray().Where(e => e.GetProperty("employeeId").GetInt32() == a),
            e =>
            {
                Assert.Equal("Fliesen", e.GetProperty("activity").GetString());
                Assert.True(e.GetProperty("noteImportant").GetBoolean());
            });
        // A vacation day has no activity.
        Assert.Equal(JsonValueKind.Null, savedEntries.EnumerateArray()
            .Single(e => e.GetProperty("type").GetString() == "Urlaub").GetProperty("activity").ValueKind);

        // One invalid day rejects the whole batch, the earlier days stay as they were.
        var rejected = await planer.PutAsJsonAsync("/api/plan/batch", new object[]
        {
            new { employeeId = a, date = $"{Year}-07-06", entries = Array.Empty<object>() },
            new { employeeId = b, date = $"{Year}-07-07", entries = new object[] { new { type = "Baustelle" } } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);

        var plan = await planer.GetFromJsonAsync<JsonElement>($"/api/plan?year={Year}");
        var ofA = plan.GetProperty("entries").EnumerateArray().Count(e => e.GetProperty("employeeId").GetInt32() == a);
        Assert.Equal(2, ofA);
    }
    [Fact]
    public async Task Employees_have_a_main_activity_and_additional_ones()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var created = await planer.PostAsJsonAsync("/api/employees", new
        {
            name = "Fliesenleger", sortOrder = 0, isActive = true, showInPlan = true, vacationDaysPerYear = 30,
            userName = (string?)null, role = "Mitarbeiter", password = (string?)null,
            mainActivity = "Fliesen", additionalActivities = new[] { "Trockenbau", "Fliesen", "Abriss" },
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        var plan = await planer.GetFromJsonAsync<JsonElement>($"/api/plan?year={Year}");
        var column = plan.GetProperty("employees").EnumerateArray().Single(e => e.GetProperty("id").GetInt32() == id);
        Assert.Equal("Fliesen", column.GetProperty("mainActivity").GetString());
        // Without the main activity and in the order of the job.
        Assert.Equal(["Abriss", "Trockenbau"],
            column.GetProperty("additionalActivities").EnumerateArray().Select(a => a.GetString()));
    }

    [Fact]
    public async Task Overlapping_time_windows_are_rejected()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var employeeId = await CreateEmployeeAsync(planer, "Overlap Tester", null, null);
        var siteA = await CreateSiteAsync(planer, "A");
        var siteB = await CreateSiteAsync(planer, "B");

        var put = await planer.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-04-01", new object[]
        {
            new { type = "Baustelle", siteId = siteA, startTime = "08:00:00", endTime = "10:00:00" },
            new { type = "Baustelle", siteId = siteB, startTime = "09:00:00", endTime = "11:00:00" },
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
        // Sites can be read (the addresses are needed on the way), but not changed.
        Assert.Equal(HttpStatusCode.OK, (await reader.GetAsync("/api/sites")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.PostAsJsonAsync("/api/sites",
            new { client = "X", nameSource = "Auftraggeber" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.GetAsync("/api/employees/names")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.GetAsync($"/api/reports/sites/1?year={Year}")).StatusCode);
    }

    [Fact]
    public async Task Employee_report_with_vacation_balance_is_only_for_planers_and_the_employee()
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
        Assert.Equal(HttpStatusCode.Forbidden, (await bernd.GetAsync(url)).StatusCode);
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
    public async Task Site_name_comes_from_the_client_or_the_street()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var site = new
        {
            client = "Hausverwaltung Nord", street = "Hauptstraße", houseNumber = "12", addressAddition = "Hinterhaus",
            postalCode = "13125", city = "Berlin", nameSource = "Strasse", description = "Komplettbad",
            plannedStart = $"{Year}-05-04", plannedEnd = $"{Year}-05-29",
        };

        var byStreet = await (await planer.PostAsJsonAsync("/api/sites", site)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Hauptstraße 12", byStreet.GetProperty("name").GetString());
        Assert.Equal("Hausverwaltung Nord", byStreet.GetProperty("client").GetString());
        Assert.Equal($"{Year}-05-04", byStreet.GetProperty("plannedStart").GetString());

        // The same client may order a second job elsewhere; switching the source renames the site.
        var second = await planer.PostAsJsonAsync("/api/sites", site with { });
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        var id = byStreet.GetProperty("id").GetInt32();
        var byClient = await (await planer.PutAsJsonAsync($"/api/sites/{id}", new
        {
            site.client, site.street, site.houseNumber, site.addressAddition, site.postalCode, site.city,
            nameSource = "Auftraggeber", site.description, site.plannedStart, site.plannedEnd,
        })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Hausverwaltung Nord", byClient.GetProperty("name").GetString());

        var noStreet = await planer.PostAsJsonAsync("/api/sites", new { client = "Ohne Adresse", nameSource = "Strasse" });
        Assert.Equal(HttpStatusCode.BadRequest, noStreet.StatusCode);

        var endBeforeStart = await planer.PostAsJsonAsync("/api/sites", new
        {
            client = "Rückwärts", nameSource = "Auftraggeber", plannedStart = $"{Year}-06-10", plannedEnd = $"{Year}-06-01",
        });
        Assert.Equal(HttpStatusCode.BadRequest, endBeforeStart.StatusCode);
    }

    [Fact]
    public async Task Duplicate_sites_are_merged_with_their_entries()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var employeeId = await CreateEmployeeAsync(planer, "Stammdaten Tester", null, null);
        var right = await CreateSiteAsync(planer, "Samarrai");
        var typo = await CreateSiteAsync(planer, "Sammarai", "Karower Damm");
        await planer.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-06-01",
            new object[] { new { type = "Baustelle", siteId = right } });
        await planer.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-06-02",
            new object[] { new { type = "Baustelle", siteId = typo } });

        var merged = await (await planer.PostAsJsonAsync($"/api/sites/{typo}/merge", new { targetId = right }))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(right, merged.GetProperty("id").GetInt32());
        // The remaining site takes over the address it did not have.
        Assert.Equal("Karower Damm", merged.GetProperty("street").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await planer.GetAsync($"/api/sites/{typo}")).StatusCode);

        var report = await planer.GetFromJsonAsync<JsonElement>($"/api/reports/sites/{right}?year={Year}");
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

    private static async Task<int> CreateSiteAsync(HttpClient planer, string client, string? street = null)
    {
        var response = await planer.PostAsJsonAsync("/api/sites", new { client, street, nameSource = "Auftraggeber" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
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
