using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>
/// The town (with the district, the Ortsteil, in cities such as Berlin) of a German postal code, from OpenPLZ
/// (openplzapi.org), so that the form of a site fills it in. Only the postal code and the street name leave
/// the server, nothing of the customer.
/// </summary>
public static partial class PostalCodeEndpoints
{
    public const string OpenPlzClient = "openplz";

    /// <summary><paramref name="City"/> is what the form takes, e.g. "Berlin-Frohnau" (the Ortsteil, else the Bezirk).</summary>
    public record PostalCodeDto(string PostalCode, string City, string? Borough, string? Suburb);

    private record Locality(string Name);
    private record Street(string Name, string? Borough, string? Suburb);

    // Postal codes do not move: what was asked once is kept while the server runs.
    private static readonly ConcurrentDictionary<string, PostalCodeDto?> Cache = new();

    public static void MapPostalCodeEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/postal-codes/{code}", async (string code, string? street, IHttpClientFactory httpClientFactory,
            ILoggerFactory loggerFactory) =>
        {
            if (!FiveDigits().IsMatch(code)) return ApiErrors.BadRequest("Eine Postleitzahl hat fünf Ziffern.");
            var streetPart = StreetPrefix(street);
            var key = $"{code}|{streetPart}";
            if (!Cache.TryGetValue(key, out var found))
            {
                try
                {
                    found = await LookUp(httpClientFactory.CreateClient(OpenPlzClient), code, streetPart);
                    Cache[key] = found;
                }
                catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
                {
                    loggerFactory.CreateLogger(nameof(PostalCodeEndpoints)).LogWarning(e, "OpenPLZ für {Code} nicht erreichbar", code);
                    return Results.StatusCode(StatusCodes.Status502BadGateway);
                }
            }
            return found is null ? Results.NotFound() : Results.Ok(found);
        }).RequireAuthorization(Policies.Plan);
    }

    private static async Task<PostalCodeDto?> LookUp(HttpClient client, string code, string? street)
    {
        var localities = await client.GetFromJsonAsync<List<Locality>>($"de/Localities?postalCode={code}") ?? [];
        if (localities.Count == 0) return null;
        var city = localities[0].Name;

        // The Ortsteil of the street, else the one most streets with this postal code lie in.
        List<Street> streets = [];
        if (street is not null)
            streets = await client.GetFromJsonAsync<List<Street>>(
                $"de/Streets?name={Uri.EscapeDataString(street)}&postalCode={code}&page=1&pageSize=10") ?? [];
        if (streets.Count == 0)
            streets = await client.GetFromJsonAsync<List<Street>>($"de/Streets?postalCode={code}&page=1&pageSize=50") ?? [];
        var place = streets.Where(s => s.Borough is not null)
            .GroupBy(s => (s.Borough, s.Suburb))
            .OrderByDescending(g => g.Count())
            .Select(g => g.Key)
            .FirstOrDefault();

        // The Ortsteil (e.g. Frohnau) says more than the Bezirk (Reinickendorf); the Bezirk only where there is none.
        var part = place.Suburb ?? place.Borough;
        return new PostalCodeDto(code, part is not null ? $"{city}-{part}" : city, place.Borough, place.Suburb);
    }

    /// <summary>The street as OpenPLZ writes it, without the house number ("Stockumer Straße 23" → "Stockumer Str.").</summary>
    private static string? StreetPrefix(string? street)
    {
        if (string.IsNullOrWhiteSpace(street)) return null;
        var name = HouseNumber().Replace(street.Trim(), "");
        name = StreetWord().Replace(name, "$1tr.");
        return name.Length >= 3 ? name : null;
    }

    [GeneratedRegex(@"^\d{5}$")]
    private static partial Regex FiveDigits();

    [GeneratedRegex(@"\s+\d+\s*[a-zA-Z]?(\s*[-/]\s*\d+\s*[a-zA-Z]?)?\s*$")]
    private static partial Regex HouseNumber();

    [GeneratedRegex(@"([sS])tra(ß|ss)e\b")]
    private static partial Regex StreetWord();
}
