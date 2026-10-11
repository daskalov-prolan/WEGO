/** The place of a construction site with a link that opens it in the map app. */
export function SiteLocation({ location }: { location: string }) {
  return (
    <span className="site-location">
      {location}{' '}
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}
        target="_blank"
        rel="noreferrer"
      >
        Karte
      </a>
    </span>
  )
}
