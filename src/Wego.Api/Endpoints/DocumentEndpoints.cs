using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>
/// The documents of a site: the protocol of a visit and the confirmation signed by the customer, both PDFs made on
/// the tablet of the visitor. He sends them (once the tablet is online); the planners open and save them.
/// </summary>
public static class DocumentEndpoints
{
    public record DocumentInput(string Kind, string FileName, string ContentBase64, string ClientKey, string? Data = null);
    public record DocumentDto(int Id, int SiteId, string Kind, string FileName, int Size, DateTime CreatedAt, string? CreatedBy,
        bool HasData = false);
    public record OfferRateDto(string Key, decimal HourlyRate);

    /// <summary>A PDF of a visit with drawings and photos stays well below this.</summary>
    private const int MaxBytes = 20 * 1024 * 1024;

    /// <summary>The planners, and the visitor who has the visit of this site in his plan.</summary>
    private static async Task<bool> MayUseAsync(ClaimsPrincipal user, int siteId, WegoDbContext db)
    {
        if (Roles.CanPlan(user.FindFirstValue(ClaimTypes.Role) ?? "")) return true;
        var me = user.EmployeeId();
        return await db.PlanEntries.AnyAsync(e => e.EmployeeId == me && e.SiteId == siteId && e.Activity == "Besichtigung");
    }

    private static DocumentDto ToDto(SiteDocument d) =>
        new(d.Id, d.SiteId, d.Kind, d.FileName, d.Content.Length, d.CreatedAt, d.CreatedBy, d.Data != null);

    public static void MapDocumentEndpoints(this IEndpointRouteBuilder app)
    {
        // The rates of the offers: read by the planners (to price the calculation of a visit), set by Planer G.
        app.MapGet("/api/offer-rates", async (WegoDbContext db) =>
            (await db.OfferRates.AsNoTracking().OrderBy(r => r.Key).ToListAsync()).Select(r => new OfferRateDto(r.Key, r.HourlyRate)))
            .RequireAuthorization(Policies.Plan);

        // All rates at once, as the page shows them; a position left empty has no rate.
        app.MapPut("/api/offer-rates", async (OfferRateDto[] input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (input.Any(r => string.IsNullOrWhiteSpace(r.Key) || r.Key.Length > 50 || r.HourlyRate is < 0 or > 1000))
                return ApiErrors.BadRequest("Bitte Stundensätze zwischen 0 und 1000 € angeben.");
            var before = await db.OfferRates.AsNoTracking().ToListAsync();
            db.OfferRates.RemoveRange(await db.OfferRates.ToListAsync());
            db.OfferRates.AddRange(input.DistinctBy(r => r.Key).Select(r => new OfferRate { Key = r.Key, HourlyRate = Math.Round(r.HourlyRate, 2) }));
            ChangeLog.Add(db, user, ChangeArea.Verwaltung, "Stundensätze Angebote", null,
                before.Select(r => new OfferRateDto(r.Key, r.HourlyRate)), input);
            await db.SaveChangesAsync();
            return Results.Ok((await db.OfferRates.AsNoTracking().OrderBy(r => r.Key).ToListAsync()).Select(r => new OfferRateDto(r.Key, r.HourlyRate)));
        }).RequireAuthorization(Policies.Admin);

        var group = app.MapGroup("/api/sites");

        // Sent by a planner, or by the visitor who has the visit of this site in his plan.
        group.MapPost("/{id:int}/documents", async (int id, DocumentInput input, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var site = await db.Sites.FindAsync(id);
            if (site is null) return Results.NotFound();
            if (!await MayUseAsync(user, id, db)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(input.Kind) || string.IsNullOrWhiteSpace(input.FileName) || string.IsNullOrWhiteSpace(input.ClientKey))
                return ApiErrors.BadRequest("Art, Dateiname und Schlüssel des Dokuments fehlen.");

            byte[] content;
            try { content = Convert.FromBase64String(input.ContentBase64); }
            catch (FormatException) { return ApiErrors.BadRequest("Das Dokument ist beschädigt."); }
            if (content.Length == 0 || content.Length > MaxBytes) return ApiErrors.BadRequest("Das Dokument ist leer oder zu groß.");
            if (content.Length < 5 || content[0] != '%' || content[1] != 'P' || content[2] != 'D' || content[3] != 'F')
                return ApiErrors.BadRequest("Nur PDF-Dokumente.");

            // Sent once more (the answer got lost): the one kept already.
            var known = await db.SiteDocuments.FirstOrDefaultAsync(d => d.SiteId == id && d.ClientKey == input.ClientKey);
            if (known is not null) return Results.Ok(ToDto(known));

            var document = new SiteDocument
            {
                SiteId = id, Kind = input.Kind.Trim()[..Math.Min(100, input.Kind.Trim().Length)],
                FileName = input.FileName.Trim()[..Math.Min(200, input.FileName.Trim().Length)],
                Content = content, CreatedAt = DateTime.UtcNow, CreatedBy = user.Identity?.Name, ClientKey = input.ClientKey,
                Data = input.Data is { Length: > 0 and <= 200_000 } ? input.Data : null,
            };
            db.SiteDocuments.Add(document);
            await db.SaveChangesAsync();
            return Results.Created($"/api/sites/documents/{document.Id}", ToDto(document));
        });

        // Read by the planners and by the visitor of the site.
        group.MapGet("/{id:int}/documents", async (int id, ClaimsPrincipal user, WegoDbContext db) =>
        {
            if (!await MayUseAsync(user, id, db)) return Results.Forbid();
            return Results.Ok((await db.SiteDocuments.AsNoTracking().Where(d => d.SiteId == id).OrderByDescending(d => d.CreatedAt)
                .Select(d => new DocumentDto(d.Id, d.SiteId, d.Kind, d.FileName, d.Content.Length, d.CreatedAt, d.CreatedBy, d.Data != null))
                .ToListAsync()));
        });

        // What was filled in on the tablet, for pricing the calculation: the planners only (not the visitor).
        group.MapGet("/documents/{documentId:int}/data", async (int documentId, WegoDbContext db) =>
        {
            var data = await db.SiteDocuments.AsNoTracking().Where(d => d.Id == documentId).Select(d => d.Data).FirstOrDefaultAsync();
            return data is null ? Results.NotFound() : Results.Text(data, "application/json");
        }).RequireAuthorization(Policies.Plan);

        // The PDF itself, to open in the browser or to save.
        group.MapGet("/documents/{documentId:int}", async (int documentId, bool? download, ClaimsPrincipal user, WegoDbContext db) =>
        {
            var document = await db.SiteDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == documentId);
            if (document is null) return Results.NotFound();
            if (!await MayUseAsync(user, document.SiteId, db)) return Results.Forbid();
            return download == true
                ? Results.File(document.Content, "application/pdf", document.FileName)
                : Results.File(document.Content, "application/pdf");
        });
    }
}
