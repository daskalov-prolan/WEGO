using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wego.Api.Data;

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
            userName = (string?)null, role = "Handwerker", password = (string?)null,
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
            userName = "ehemalig", role = "Handwerker", password = (string?)null,
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
            plannedStart = $"{Year}-05-04", plannedEnd = $"{Year}-05-29", labelProjectNumber = "P-2026-0815",
        };

        var byStreet = await (await planer.PostAsJsonAsync("/api/sites", site)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Hauptstraße 12", byStreet.GetProperty("name").GetString());
        Assert.Equal("Hausverwaltung Nord", byStreet.GetProperty("client").GetString());
        Assert.Equal($"{Year}-05-04", byStreet.GetProperty("plannedStart").GetString());
        Assert.Equal("P-2026-0815", byStreet.GetProperty("labelProjectNumber").GetString());

        // The same client may order a second job elsewhere; switching the source renames the site.
        var second = await planer.PostAsJsonAsync("/api/sites", site with { });
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        var id = byStreet.GetProperty("id").GetInt32();
        var byClient = await (await planer.PutAsJsonAsync($"/api/sites/{id}", new
        {
            site.client, site.street, site.houseNumber, site.addressAddition, site.postalCode, site.city,
            nameSource = "Auftraggeber", site.description, site.plannedStart, site.plannedEnd, site.labelProjectNumber,
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
    public async Task Site_status_follows_the_job_and_every_change_is_logged()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var id = await CreateSiteAsync(planer, "Statusbaustelle");
        Task<HttpResponseMessage> Change(string status) =>
            planer.PostAsJsonAsync($"/api/sites/{id}/status", new { status });

        var site = await planer.GetFromJsonAsync<JsonElement>($"/api/sites/{id}");
        Assert.Equal("Angebot", site.GetProperty("status").GetString());

        // Not two steps at once, and not back to the offer.
        Assert.Equal(HttpStatusCode.BadRequest, (await Change("Abgeschlossen")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Change("Bauphase")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Change("Angebot")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Change("Abgeschlossen")).StatusCode);
        // Done, but more to do after all: back to the construction phase (its activities are not doubled).
        var reopened = await (await Change("Bauphase")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Bauphase", reopened.GetProperty("status").GetString());
        var keys = reopened.GetProperty("tasks").EnumerateArray().Select(t => t.GetProperty("activity").GetString()).ToList();
        Assert.Equal(keys.Count, keys.Distinct().Count());
        Assert.Equal(HttpStatusCode.OK, (await Change("Abgeschlossen")).StatusCode);
        // Cancelled can follow any status, but nothing follows it.
        Assert.Equal(HttpStatusCode.OK, (await Change("Storniert")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Change("Bauphase")).StatusCode);

        var history = await planer.GetFromJsonAsync<JsonElement>($"/api/sites/{id}/history");
        Assert.Equal(["Angebot", "Bauphase", "Abgeschlossen", "Bauphase", "Abgeschlossen", "Storniert"],
            history.EnumerateArray().Select(c => c.GetProperty("to").GetString()));
        Assert.Equal(JsonValueKind.Null, history[0].GetProperty("from").ValueKind);
        Assert.Equal("Planer", history[1].GetProperty("changedBy").GetString());

        var direct = await planer.PostAsJsonAsync("/api/sites", new { client = "Direkt", nameSource = "Auftraggeber", status = "Bauphase" });
        Assert.Equal("Bauphase", (await direct.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        var closed = await planer.PostAsJsonAsync("/api/sites", new { client = "Zu", nameSource = "Auftraggeber", status = "Abgeschlossen" });
        Assert.Equal(HttpStatusCode.BadRequest, closed.StatusCode);
    }
    [Fact]
    public async Task A_status_brings_its_activities_as_tasks()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var id = await CreateSiteAsync(planer, "Aufgaben");
        string[] Activities(JsonElement site) => site.GetProperty("tasks").EnumerateArray()
            .Select(t => t.GetProperty("activity").GetString()!).ToArray();

        var offer = await planer.GetFromJsonAsync<JsonElement>($"/api/sites/{id}");
        Assert.Equal(["Besichtigung", "Objektauswahl", "Angebotsuebergabe"], Activities(offer));

        var building = await (await planer.PostAsJsonAsync($"/api/sites/{id}/status", new { status = "Bauphase" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(9, Activities(building).Length);

        var changed = await (await planer.PutAsJsonAsync($"/api/sites/{id}/tasks/RenoDeco",
            new { estimatedDays = 1, notNeeded = true })).Content.ReadFromJsonAsync<JsonElement>();
        var renoDeco = changed.GetProperty("tasks").EnumerateArray().Single(t => t.GetProperty("activity").GetString() == "RenoDeco");
        Assert.True(renoDeco.GetProperty("notNeeded").GetBoolean());
        var tiles = await planer.PutAsJsonAsync($"/api/sites/{id}/tasks/Fliesen", new { estimatedDays = 0, notNeeded = false });
        Assert.Equal(HttpStatusCode.BadRequest, tiles.StatusCode);
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

    [Fact]
    public async Task Changes_are_logged_with_time_author_before_and_after()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var started = DateTime.UtcNow.AddSeconds(-1);
        var employeeId = await CreateEmployeeAsync(planer, "Log Tester", null, null);
        var siteId = await CreateSiteAsync(planer, "Familie Protokoll");
        var url = $"/api/plan/{employeeId}/{Year}-05-04";

        await planer.PutAsJsonAsync(url, new object[] { new { type = "Baustelle", siteId, note = "erst" } });
        // Saved again unchanged: no new log entry.
        await planer.PutAsJsonAsync(url, new object[] { new { type = "Baustelle", siteId, note = "erst" } });
        await planer.PutAsJsonAsync(url, new object[] { new { type = "Urlaub" } });
        await planer.PutAsJsonAsync(url, Array.Empty<object>());

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WegoDbContext>();
        var plan = await db.ChangeLog
            .Where(c => c.Area == ChangeArea.Plan && c.EntityId == employeeId)
            .OrderBy(c => c.Id).ToListAsync();

        Assert.Equal(["Eingetragen", "Geändert", "Gelöscht"], plan.Select(c => c.Action));
        Assert.All(plan, c =>
        {
            Assert.Equal(new DateOnly(Year, 5, 4), c.Date);
            Assert.Equal("Planer", c.ChangedBy);
            Assert.True(c.ChangedAt >= started);
        });
        Assert.Null(plan[0].Before);
        Assert.Contains("Familie Protokoll", plan[0].After);
        Assert.Contains("Familie Protokoll", plan[1].Before);
        Assert.Contains("Urlaub", plan[1].After);
        Assert.Null(plan[2].After);

        Assert.True(await db.ChangeLog.AnyAsync(c =>
            c.Area == ChangeArea.Mitarbeiter && c.EntityId == employeeId && c.Action == "Angelegt"));
        Assert.True(await db.ChangeLog.AnyAsync(c =>
            c.Area == ChangeArea.Baustelle && c.EntityId == siteId && c.Action == "Angelegt"));
    }

    [Fact]
    public async Task Passwords_never_reach_the_change_log()
    {
        var planer = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var employeeId = await CreateEmployeeAsync(planer, "Geheim Tester", "geheim.tester", "streng-geheim-123");
        await planer.PostAsync($"/api/employees/{employeeId}/access", null);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WegoDbContext>();
        var logged = await db.ChangeLog.Where(c => c.Area == ChangeArea.Mitarbeiter && c.EntityId == employeeId)
            .ToListAsync();
        var hash = (await db.Employees.SingleAsync(e => e.Id == employeeId)).PasswordHash!;

        Assert.Equal(["Angelegt", "Passwort zurückgesetzt"], logged.OrderBy(c => c.Id).Select(c => c.Action));
        Assert.All(logged, c =>
        {
            Assert.DoesNotContain("streng-geheim-123", (c.Before ?? "") + c.After);
            Assert.DoesNotContain(hash, (c.Before ?? "") + c.After);
        });
    }

    [Fact]
    public async Task Planer_A_plans_but_sees_neither_employees_nor_administration()
    {
        var g = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        await CreateEmployeeAsync(g, "Planerin A", "planerin.a", "planer-a-pw", "PlanerA");
        await CreateEmployeeAsync(g, "Handwerker H", "handwerker.h", "handwerker-pw");
        var a = await LoginAsync("planerin.a", "planer-a-pw");
        var h = await LoginAsync("handwerker.h", "handwerker-pw");

        // Planer A: plan and sites.
        var siteId = await CreateSiteAsync(a, "Familie Rechte");
        Assert.Equal(HttpStatusCode.OK, (await a.GetAsync($"/api/reports/sites/{siteId}?year={Year}")).StatusCode);
        // Not the employees, their reports and vacation, nor the administration.
        Assert.Equal(HttpStatusCode.Forbidden, (await a.GetAsync("/api/employees")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await a.GetAsync($"/api/reports/vacation?year={Year}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await a.GetAsync($"/api/reports/employees/1?year={Year}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await a.PostAsJsonAsync("/api/activities", new { label = "Elektro", phase = "Bauphase", color = "#123456" })).StatusCode);

        // Planners without a column in the plan come along for the offer phase; craftsmen are no planners.
        var plan = await a.GetFromJsonAsync<JsonElement>($"/api/plan?year={Year}");
        var planner = plan.GetProperty("planners").EnumerateArray().Single(p => p.GetProperty("name").GetString() == "Planer");
        Assert.True(planner.GetProperty("isPlaner").GetBoolean());
        Assert.DoesNotContain(plan.GetProperty("employees").EnumerateArray(), e => e.GetProperty("name").GetString() == "Planer");
        Assert.False(plan.GetProperty("employees").EnumerateArray()
            .Single(e => e.GetProperty("name").GetString() == "Handwerker H").GetProperty("isPlaner").GetBoolean());

        // Handwerker only read.
        Assert.Equal(HttpStatusCode.OK, (await h.GetAsync($"/api/plan?year={Year}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await h.PostAsJsonAsync("/api/sites", new { client = "Nein", nameSource = "Auftraggeber" })).StatusCode);

        // The last Planer G cannot give up the role.
        var me = await g.GetFromJsonAsync<JsonElement>("/api/auth/me");
        var demote = await g.PutAsJsonAsync($"/api/employees/{me.GetProperty("id").GetInt32()}", new
        {
            name = "Planer", sortOrder = 0, isActive = true, showInPlan = false, vacationDaysPerYear = 30,
            userName = WegoApiFactory.PlanerUserName, role = "PlanerA", password = (string?)null,
        });
        Assert.Equal(HttpStatusCode.BadRequest, demote.StatusCode);
    }

    [Fact]
    public async Task Planer_G_keep_the_hourly_rates_and_a_site_report_spans_all_years()
    {
        var g = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        await CreateEmployeeAsync(g, "Planer Satz", "planer.satz", "planer-a-pw", "PlanerA");
        var a = await LoginAsync("planer.satz", "planer-a-pw");
        var employeeId = await CreateEmployeeAsync(g, "Maurer", null, null);

        // The usual rate is kept with the employee.
        object Maurer(decimal? hourlyRate) => new
        {
            name = "Maurer", sortOrder = 0, isActive = true, showInPlan = true, vacationDaysPerYear = 30,
            userName = (string?)null, role = "Handwerker", password = (string?)null, hourlyRate,
        };
        var rate = await g.PutAsJsonAsync($"/api/employees/{employeeId}", Maurer(38.5m));
        Assert.Equal(HttpStatusCode.OK, rate.StatusCode);
        Assert.Equal(38.5m, (await rate.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("hourlyRate").GetDecimal());
        Assert.Equal(HttpStatusCode.BadRequest, (await g.PutAsJsonAsync($"/api/employees/{employeeId}", Maurer(-1))).StatusCode);

        // A site can have its own rate for an employee; empty goes back to the usual one. Planer G only.
        var siteId = await CreateSiteAsync(a, "Familie Jahreswechsel");
        var own = await g.PutAsJsonAsync($"/api/sites/{siteId}/hourly-rates/{employeeId}", new { hourlyRate = 42.255m });
        Assert.Equal(HttpStatusCode.OK, own.StatusCode);
        var rates = await g.GetFromJsonAsync<JsonElement>($"/api/sites/{siteId}/hourly-rates");
        Assert.Equal(42.26m, rates.EnumerateArray().Single().GetProperty("hourlyRate").GetDecimal());
        Assert.Equal(HttpStatusCode.Forbidden, (await a.GetAsync($"/api/sites/{siteId}/hourly-rates")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await a.PutAsJsonAsync($"/api/sites/{siteId}/hourly-rates/{employeeId}", new { hourlyRate = 10 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await g.PutAsJsonAsync($"/api/sites/{siteId}/hourly-rates/{employeeId}", new { hourlyRate = 1001 })).StatusCode);
        var cleared = await g.PutAsJsonAsync($"/api/sites/{siteId}/hourly-rates/{employeeId}", new { hourlyRate = (decimal?)null });
        Assert.Equal(0, (await cleared.Content.ReadFromJsonAsync<JsonElement>()).GetArrayLength());
        Assert.Equal(38.5m, (await g.GetFromJsonAsync<JsonElement>("/api/employees")).EnumerateArray()
            .Single(e => e.GetProperty("id").GetInt32() == employeeId).GetProperty("hourlyRate").GetDecimal());

        // Without a year the report of a site covers its whole time.
        await a.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-12-30", new object[] { new { type = "Baustelle", siteId } });
        await a.PutAsJsonAsync($"/api/plan/{employeeId}/{Year + 1}-01-04", new object[] { new { type = "Baustelle", siteId } });
        var oneYear = await a.GetFromJsonAsync<JsonElement>($"/api/reports/sites/{siteId}?year={Year}");
        var whole = await a.GetFromJsonAsync<JsonElement>($"/api/reports/sites/{siteId}");
        Assert.Equal(1, oneYear.GetProperty("entries").GetArrayLength());
        Assert.Equal(2, whole.GetProperty("entries").GetArrayLength());
        Assert.Equal(0, whole.GetProperty("year").GetInt32());
    }

    [Fact]
    public async Task Planer_A_delete_a_site_and_with_entries_only_when_asked_again()
    {
        var g = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        await CreateEmployeeAsync(g, "Planer Löschen", "planer.loeschen", "planer-a-pw", "PlanerA");
        var a = await LoginAsync("planer.loeschen", "planer-a-pw");
        var employeeId = await CreateEmployeeAsync(g, "Fliesenleger", null, null);

        var empty = await CreateSiteAsync(a, "Familie Leer");
        Assert.Equal(HttpStatusCode.NoContent, (await a.DeleteAsync($"/api/sites/{empty}")).StatusCode);

        var used = await CreateSiteAsync(a, "Familie Voll");
        await a.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-08-03", new object[] { new { type = "Baustelle", siteId = used } });
        await a.PutAsJsonAsync($"/api/plan/{employeeId}/{Year}-08-04", new object[] { new { type = "Baustelle", siteId = used } });
        var asked = await a.DeleteAsync($"/api/sites/{used}");
        Assert.Equal(HttpStatusCode.Conflict, asked.StatusCode);
        Assert.Equal(2, (await asked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries").GetInt32());

        Assert.Equal(HttpStatusCode.NoContent, (await a.DeleteAsync($"/api/sites/{used}?withEntries=true")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await a.GetAsync($"/api/sites/{used}")).StatusCode);
        var plan = await a.GetFromJsonAsync<JsonElement>($"/api/plan?year={Year}");
        Assert.DoesNotContain(plan.GetProperty("entries").EnumerateArray(), e => e.GetProperty("employeeId").GetInt32() == employeeId);
    }

    [Fact]
    public async Task Only_Planer_G_enter_or_remove_vacation_and_sick_days()
    {
        var g = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        await CreateEmployeeAsync(g, "Planer Urlaub", "planer.urlaub", "planer-a-pw", "PlanerA");
        var a = await LoginAsync("planer.urlaub", "planer-a-pw");
        var employeeId = await CreateEmployeeAsync(g, "Urlauber", null, null);
        var siteId = await CreateSiteAsync(g, "Familie Ferien");
        var day = $"/api/plan/{employeeId}/{Year}-07-06";
        var vacation = new object[] { new { type = "Urlaub" } };

        // Planer A plans sites, but neither enters Urlaub nor replaces it.
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PutAsJsonAsync(day, vacation)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await g.PutAsJsonAsync(day, vacation)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await a.PutAsJsonAsync(day, new object[] { new { type = "Baustelle", siteId } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PutAsJsonAsync(day, Array.Empty<object>())).StatusCode);
        // Next to it a site is fine, the vacation stays as it is.
        Assert.Equal(HttpStatusCode.OK,
            (await a.PutAsJsonAsync(day, new object[] { new { type = "Urlaub" }, new { type = "Baustelle", siteId } })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await g.PutAsJsonAsync(day, Array.Empty<object>())).StatusCode);
    }

    [Fact]
    public async Task Planer_G_keep_the_activities_and_a_deleted_one_leaves_entries_without_it()
    {
        var g = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var created = await g.PostAsJsonAsync("/api/activities", new { label = "Elektro-Arbeiten", phase = "Bauphase", color = "#123456" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var key = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("key").GetString();
        Assert.Equal("ElektroArbeiten", key);

        // A site entering the construction phase gets it as a task; employees and entries can use it.
        var siteId = await CreateSiteAsync(g, "Familie Strom");
        var building = await (await g.PostAsJsonAsync($"/api/sites/{siteId}/status", new { status = "Bauphase" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(building.GetProperty("tasks").EnumerateArray(), t => t.GetProperty("activity").GetString() == key);
        var employeeId = await CreateEmployeeAsync(g, "Elektriker", null, null, mainActivity: key);
        var day = $"/api/plan/{employeeId}/{Year}-06-01";
        Assert.Equal(HttpStatusCode.OK,
            (await g.PutAsJsonAsync(day, new object[] { new { type = "Baustelle", siteId, activity = key } })).StatusCode);

        // Renamed and moved to the front: the key stays.
        Assert.Equal(HttpStatusCode.OK,
            (await g.PutAsJsonAsync($"/api/activities/{key}", new { label = "Elektro", phase = "Bauphase", color = "#654321" })).StatusCode);
        var all = await g.GetFromJsonAsync<JsonElement>("/api/activities");
        var order = all.EnumerateArray().Select(a => a.GetProperty("key").GetString()!).Where(k => k != key).Prepend(key!).ToArray();
        var reordered = await (await g.PutAsJsonAsync("/api/activities/order", order)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Elektro", reordered[0].GetProperty("label").GetString());

        var usage = await g.GetFromJsonAsync<JsonElement>($"/api/activities/{key}/usage");
        Assert.Equal(1, usage.GetProperty("entries").GetInt32());
        Assert.Equal(1, usage.GetProperty("employees").GetInt32());

        Assert.Equal(HttpStatusCode.NoContent, (await g.DeleteAsync($"/api/activities/{key}")).StatusCode);
        var plan = await g.GetFromJsonAsync<JsonElement>($"/api/plan?year={Year}");
        var entry = plan.GetProperty("entries").EnumerateArray().Single(e => e.GetProperty("employeeId").GetInt32() == employeeId);
        Assert.Equal(siteId, entry.GetProperty("siteId").GetInt32());
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("activity").ValueKind);
        var employee = plan.GetProperty("employees").EnumerateArray().Single(e => e.GetProperty("id").GetInt32() == employeeId);
        Assert.Equal(JsonValueKind.Null, employee.GetProperty("mainActivity").ValueKind);
        var site = await g.GetFromJsonAsync<JsonElement>($"/api/sites/{siteId}");
        Assert.DoesNotContain(site.GetProperty("tasks").EnumerateArray(), t => t.GetProperty("activity").GetString() == key);
    }

    [Fact]
    public async Task Only_who_does_offer_work_sees_the_offer_phase()
    {
        var g = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var offerSite = await CreateSiteAsync(g, "Familie Angebot");
        var visitor = await CreateEmployeeAsync(g, "Besucherin", "besucherin", "besucherin-pw", mainActivity: "Besichtigung");
        await CreateEmployeeAsync(g, "Bauer", "bauer", "bauer-pw", mainActivity: "Fliesen");
        await g.PutAsJsonAsync($"/api/plan/{visitor}/{Year}-07-01", new object[] { new { type = "Baustelle", siteId = offerSite, activity = "Besichtigung" } });
        await g.PutAsJsonAsync($"/api/plan/{visitor}/{Year}-07-02", new object[] { new { type = "Baustelle", activity = "Objektauswahl" } });
        await g.PutAsJsonAsync($"/api/plan/{visitor}/{Year}-07-03", new object[] { new { type = "Urlaub" } });

        async Task<JsonElement> PlanOf(string userName, string password) =>
            await (await LoginAsync(userName, password)).GetFromJsonAsync<JsonElement>($"/api/plan?year={Year}");
        IEnumerable<int> SiteIds(JsonElement plan) => plan.GetProperty("sites").EnumerateArray().Select(s => s.GetProperty("id").GetInt32());
        IEnumerable<string> DaysOf(JsonElement plan, int employeeId) => plan.GetProperty("entries").EnumerateArray()
            .Where(e => e.GetProperty("employeeId").GetInt32() == employeeId).Select(e => e.GetProperty("date").GetString()!);

        // The menu learns it at sign-in.
        async Task<bool> SeesOffers(string userName, string password) =>
            (await (await LoginAsync(userName, password)).GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("seesOffers").GetBoolean();
        Assert.True(await SeesOffers("besucherin", "besucherin-pw"));
        Assert.False(await SeesOffers("bauer", "bauer-pw"));
        Assert.True(await SeesOffers(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword));

        var seen = await PlanOf("besucherin", "besucherin-pw");
        Assert.True(seen.GetProperty("offerPhase").GetBoolean());
        Assert.Contains(offerSite, SiteIds(seen));

        // Without any offer activity: neither the offer site nor the visits of others, but still the vacation.
        var hidden = await PlanOf("bauer", "bauer-pw");
        Assert.False(hidden.GetProperty("offerPhase").GetBoolean());
        Assert.DoesNotContain(offerSite, SiteIds(hidden));
        Assert.Equal([$"{Year}-07-03"], DaysOf(hidden, visitor));
        Assert.Empty(hidden.GetProperty("planners").EnumerateArray());
        var client = await LoginAsync("bauer", "bauer-pw");
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/sites/{offerSite}")).StatusCode);
    }

    [Fact]
    public async Task A_site_keeps_the_phone_number_of_the_customer()
    {
        var g = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var created = await g.PostAsJsonAsync("/api/sites",
            new { client = "Familie Anruf", clientPhone = " 030 1234567 ", nameSource = "Auftraggeber" });
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        var site = await g.GetFromJsonAsync<JsonElement>($"/api/sites/{id}");
        Assert.Equal("030 1234567", site.GetProperty("clientPhone").GetString());
        var tooLong = await g.PutAsJsonAsync($"/api/sites/{id}",
            new { client = "Familie Anruf", clientPhone = new string('1', 51), nameSource = "Auftraggeber" });
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
    }

    [Fact]
    public async Task An_offer_activity_can_be_planned_before_the_site_is_known()
    {
        var g = await LoginAsync(WegoApiFactory.PlanerUserName, WegoApiFactory.PlanerPassword);
        var employeeId = await CreateEmployeeAsync(g, "Berater", null, null, mainActivity: "Besichtigung");
        var url = $"/api/plan/{employeeId}/{Year}-06-02";

        // Two visits on one day, no site yet.
        var saved = await g.PutAsJsonAsync(url, new object[]
        {
            new { type = "Baustelle", activity = "Besichtigung", startTime = "08:00:00", endTime = "09:00:00" },
            new { type = "Baustelle", activity = "Besichtigung", startTime = "10:00:00", endTime = "11:00:00" },
        });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Equal(2, (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetArrayLength());

        // Neither site nor activity: that is no entry.
        var empty = await g.PutAsJsonAsync(url, new object[] { new { type = "Baustelle" } });
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
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
        string? password, string role = "Handwerker", string? mainActivity = null)
    {
        var response = await planer.PostAsJsonAsync("/api/employees", new
        {
            name, sortOrder = 0, isActive = true, showInPlan = true, vacationDaysPerYear = 30,
            userName, role, password, mainActivity,
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }
}
