import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { Site, SiteMapLocation } from '../api/types'
import { SITE_STATUSES } from '../lib/activities'
import { formatAddress } from '../lib/sites'

/** The middle of Berlin: where the map opens without sites. */
const BERLIN: L.LatLngTuple = [52.52, 13.405]

export interface MapPoint {
  site: Site
  location: SiteMapLocation
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * A map of Berlin (OpenStreetMap) with a dot per site in the colour of its status; a click on a dot shows
 * name and address, and `linkToPage` leads on to the page of the site.
 */
export function SitesMap({ points, height = 520, linkToPage = true }: { points: MapPoint[]; height?: number; linkToPage?: boolean }) {
  const element = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!element.current) return
    map.current = L.map(element.current).setView(BERLIN, 11)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (!map.current || !layer.current) return
    layer.current.clearLayers()
    for (const { site, location } of points) {
      const colour = SITE_STATUSES.find((status) => status.value === site.status)?.hex ?? '#1c7ed6'
      const address = formatAddress(site)
      L.circleMarker([location.latitude, location.longitude], {
        radius: 9,
        color: '#fff',
        weight: 2,
        fillColor: colour,
        fillOpacity: 0.95,
      })
        // Several sites: every name stands next to its dot; one alone is named in the title.
        .bindTooltip(escape(site.name), points.length > 1 ? { permanent: true, direction: 'right', offset: [8, 0], className: 'map-label' } : {})
        .bindPopup(
          `<strong>${escape(site.name)}</strong>` +
            (address ? `<br>${escape(address)}` : '') +
            (linkToPage ? `<br><a href="#/baustellen/${site.id}">Baustelle öffnen</a>` : ''),
        )
        .addTo(layer.current)
    }
    // All dots in sight; one alone close up.
    if (points.length === 1) map.current.setView([points[0].location.latitude, points[0].location.longitude], 15)
    else if (points.length > 1)
      map.current.fitBounds(L.latLngBounds(points.map((p) => [p.location.latitude, p.location.longitude])), { padding: [30, 30], maxZoom: 15 })
  }, [points, linkToPage])

  return <div ref={element} className="sites-map" style={{ height }} role="region" aria-label="Karte der Baustellen" />
}
