/** A route over the stops in Google Maps, from the start and back to the company: opens the Maps app, free of charge. */
export function mapsLink(addresses: (string | null)[]): string {
  return 'https://www.google.com/maps/dir/' + addresses.filter(Boolean).map((address) => encodeURIComponent(address!)).join('/')
}
