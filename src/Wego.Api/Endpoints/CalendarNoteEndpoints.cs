using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>
/// Notes in the field of an employee and a day of the plan, not tied to a site (e.g. "Arzttermin 14 Uhr").
/// Everybody sees them with the plan; planners write them.
/// </summary>
public static class CalendarNoteEndpoints
{
    public const int MaxTitle = 40;
    public const int MaxText = 1000;

    public record CalendarNoteDto(int Id, int EmployeeId, DateOnly Date, string Title, string? Text);
    public record CalendarNoteInput(int EmployeeId, DateOnly Date, string? Title, string? Text);

    public static void MapCalendarNoteEndpoints(this IEndpointRouteBuilder app)
    {
        var notes = app.MapGroup("/api/plan/notes").RequireAuthorization(Policies.Plan);

        notes.MapPost("", async (CalendarNoteInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var error = Validate(input);
            if (error is not null) return ApiErrors.BadRequest(error);
            if (!await db.Employees.AnyAsync(e => e.Id == input.EmployeeId)) return Results.NotFound();
            var note = new CalendarNote
            {
                EmployeeId = input.EmployeeId, Date = input.Date, Title = input.Title!.Trim(), Text = Clean(input.Text),
            };
            db.CalendarNotes.Add(note);
            ChangeLog.Add(db, user, ChangeArea.Plan, "Notiz eingetragen", note.EmployeeId, null, ToDto(note), note.Date);
            await db.SaveChangesAsync();
            return Results.Created($"/api/plan/notes/{note.Id}", ToDto(note));
        });

        notes.MapPut("/{id:int}", async (int id, CalendarNoteInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var note = await db.CalendarNotes.FindAsync(id);
            if (note is null) return Results.NotFound();
            var error = Validate(input);
            if (error is not null) return ApiErrors.BadRequest(error);
            var before = ToDto(note);
            // The note stays in its field: only the title and the explanation change.
            note.Title = input.Title!.Trim();
            note.Text = Clean(input.Text);
            ChangeLog.Add(db, user, ChangeArea.Plan, "Notiz geändert", note.EmployeeId, before, ToDto(note), note.Date);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(note));
        });

        notes.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var note = await db.CalendarNotes.FindAsync(id);
            if (note is null) return Results.NotFound();
            db.CalendarNotes.Remove(note);
            ChangeLog.Add(db, user, ChangeArea.Plan, "Notiz gelöscht", note.EmployeeId, ToDto(note), null, note.Date);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    public static CalendarNoteDto ToDto(CalendarNote note) => new(note.Id, note.EmployeeId, note.Date, note.Title, note.Text);

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static string? Validate(CalendarNoteInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Title)) return "Bitte eine Überschrift eingeben.";
        if (input.Title.Trim().Length > MaxTitle) return $"Die Überschrift darf höchstens {MaxTitle} Zeichen haben.";
        if ((input.Text?.Trim().Length ?? 0) > MaxText) return $"Die Erklärung darf höchstens {MaxText} Zeichen haben.";
        return null;
    }
}
