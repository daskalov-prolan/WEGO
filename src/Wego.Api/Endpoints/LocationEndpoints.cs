using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wego.Api.Data;

namespace Wego.Api.Endpoints;

/// <summary>Finds the place of an address on the map.</summary>
public interface IGeocoder
{
    /// <returns>Latitude and longitude, or null when the address is not found.</returns>
    /// <exception cref="HttpRequestException">The service cannot be reached: the address is asked again later.</exception>
    Task<(double Latitude, double Longitude)?> LocateAsync(string street, string? postalCode, string? city);
}

/// <summary>
/// Addresses from OpenStreetMap (Nominatim). Only the address leaves the server, never the customer. Their
/// rules allow one request per second; the places found are kept with the site, so each address is asked once.
/// </summary>
public class NominatimGeocoder(IHttpClientFactory httpClientFactory, ILogger<NominatimGeocoder> logger) : IGeocoder
{
    public const string Client = "nominatim";

    private static readonly SemaphoreSlim OneAtATime = new(1, 1);
    private static DateTime lastRequest = DateTime.MinValue;

    public async Task<(double Latitude, double Longitude)?> LocateAsync(string street, string? postalCode, string? city)
    {
        await OneAtATime.WaitAsync();
        try
        {
            var wait = lastRequest.AddSeconds(1.1) - DateTime.UtcNow;
            if (wait > TimeSpan.Zero) await Task.Delay(wait);
            lastRequest = DateTime.UtcNow;

            var query = $"search?format=jsonv2&limit=1&countrycodes=de&street={Uri.EscapeDataString(street)}"
                + (postalCode is null ? "" : $"&postalcode={Uri.EscapeDataString(postalCode)}")
                // "Berlin-Pankow": the city is Berlin, the borough only helps a person.
                + (city is null ? "" : $"&city={Uri.EscapeDataString(city.Split('-')[0].Trim())}");
            using var answer = JsonDocument.Parse(await httpClientFactory.CreateClient(Client).GetStringAsync(query));
            var first = answer.RootElement.EnumerateArray().FirstOrDefault();
            if (first.ValueKind != JsonValueKind.Object) return null;
            return (double.Parse(first.GetProperty("lat").GetString()!, CultureInfo.InvariantCulture),
                double.Parse(first.GetProperty("lon").GetString()!, CultureInfo.InvariantCulture));
        }
        catch (Exception e) when (e is JsonException or FormatException)
        {
            logger.LogWarning(e, "Adresse nicht gefunden: {Street}, {PostalCode} {City}", street, postalCode, city);
            return null;
        }
        finally
        {
            OneAtATime.Release();
        }
    }
}

/// <summary>Where the sites are, for the map of the sites.</summary>
public static class LocationEndpoints
{
    /// <summary>How many addresses one request looks up at most (about a second each); the map asks again for the rest.</summary>
    public const int LookUpsPerRequest = 5;

    public record LocationDto(int SiteId, double Latitude, double Longitude);
    /// <summary><paramref name="Pending"/>: sites with an address whose place is not looked up yet.</summary>
    public record LocationsDto(IReadOnlyList<LocationDto> Locations, int Pending);

    public static void MapLocationEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/sites/locations", async (ClaimsPrincipal user, WegoDbContext db, IGeocoder geocoder) =>
        {
            var access = await OfferAccess.ForAsync(user, db);
            var sites = (await db.Sites.ToListAsync()).Where(access.Shows).ToList();
            var open = sites.Where(NeedsLookUp).ToList();
            foreach (var site in open.Take(LookUpsPerRequest))
                if (!await LookUpAsync(site, geocoder)) break;
            await db.SaveChangesAsync();

            return new LocationsDto(
                sites.Where(s => s.Latitude is not null && s.Longitude is not null)
                    .Select(s => new LocationDto(s.Id, s.Latitude!.Value, s.Longitude!.Value)).ToList(),
                sites.Count(NeedsLookUp));
        }).RequireAuthorization(Policies.Plan);

        app.MapGet("/api/sites/{id:int}/location", async (int id, ClaimsPrincipal user, WegoDbContext db, IGeocoder geocoder) =>
        {
            var site = await db.Sites.FindAsync(id);
            if (site is null || !(await OfferAccess.ForAsync(user, db)).Shows(site)) return Results.NotFound();
            if (NeedsLookUp(site) && await LookUpAsync(site, geocoder)) await db.SaveChangesAsync();
            return site.Latitude is { } latitude && site.Longitude is { } longitude
                ? Results.Ok(new LocationDto(site.Id, latitude, longitude))
                : Results.NotFound(new { message = "Die Adresse wurde auf der Karte nicht gefunden." });
        }).RequireAuthorization();
    }

    /// <summary>The address as it was looked up: a changed address is looked up again.</summary>
    public static string? AddressKey(Site site) =>
        string.IsNullOrWhiteSpace(site.Street) ? null : $"{site.Street}|{site.HouseNumber}|{site.PostalCode}|{site.City}";

    private static bool NeedsLookUp(Site site) => AddressKey(site) is { } key && key != site.GeocodedFor;

    /// <returns>false when the service cannot be reached (nothing is kept then).</returns>
    private static async Task<bool> LookUpAsync(Site site, IGeocoder geocoder)
    {
        var street = string.Join(' ', new[] { site.Street, site.HouseNumber }.Where(s => !string.IsNullOrWhiteSpace(s)));
        (double Latitude, double Longitude)? place;
        try
        {
            place = await geocoder.LocateAsync(street, site.PostalCode, site.City);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return false;
        }
        site.Latitude = place?.Latitude;
        site.Longitude = place?.Longitude;
        // Also when not found: the same address is not asked again.
        site.GeocodedFor = AddressKey(site);
        return true;
    }
}
