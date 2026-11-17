import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { PlannedVisit, VisitDay, VisitEnquiry, VisitPlace } from '../api/types'
import { shortDate, waiting } from '../lib/visitText'

/** The middle of Berlin: where the map opens without customers. */
const BERLIN: L.LatLngTuple = [52.52, 13.405]
const OPEN = '#d71f27'
const AGREED = '#0f6378'

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The branches of WEGO: yellow stars without a name. */
const star = L.divIcon({ className: 'visit-branch', html: '★', iconSize: [26, 26], iconAnchor: [13, 13] })

/**
 * The customers on a map (OpenStreetMap), each with its name: those waiting in red, the visits agreed in petrol with
 * their day, the branches as yellow stars. A tap on a customer waiting shows address, telephone and how long waiting,
 * and leads on to entering the appointment.
 */
export function VisitMap({ enquiries, visits, branches, onPlan }: {
  enquiries: VisitEnquiry[]
  visits: { visit: PlannedVisit; day: VisitDay }[]
  branches: VisitPlace[]
  onPlan: (siteId: number) => void
}) {
  const element = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const plan = useRef(onPlan)
  plan.current = onPlan

  useEffect(() => {
    if (!element.current) return
    map.current = L.map(element.current).setView(BERLIN, 11)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map.current)
    // The stars of the branches below the customers: a customer next door stays to be tapped.
    map.current.createPane('branches').style.zIndex = '350'
    layer.current = L.layerGroup().addTo(map.current)
    // Opened in a window that is still sliding in: the size taken again once it stands.
    const settle = window.setTimeout(() => map.current?.invalidateSize(), 400)
    return () => {
      window.clearTimeout(settle)
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (!map.current || !layer.current) return
    layer.current.clearLayers()
    const points: L.LatLngTuple[] = []
    const dot = (lat: number, lng: number, colour: string) => {
      points.push([lat, lng])
      return L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 3, fillColor: colour, fillOpacity: 1 })
    }

    for (const { visit, day } of visits) {
      if (visit.latitude === null || visit.longitude === null) continue
      dot(visit.latitude, visit.longitude, AGREED)
        .bindTooltip(`${escape(visit.name)} · ${shortDate(day.date)}`, { permanent: true, direction: 'left', offset: [-8, 0], className: 'visit-tag agreed' })
        .bindPopup(
          `<strong>${escape(visit.name)}</strong>` +
            (visit.address ? `<br>${escape(visit.address)}` : '') +
            `<br>${shortDate(day.date)} ${visit.from.slice(0, 5)} · ${escape(day.employee)}`,
        )
        .addTo(layer.current)
    }

    for (const enquiry of enquiries) {
      if (enquiry.latitude === null || enquiry.longitude === null) continue
      const popup = document.createElement('div')
      popup.innerHTML =
        `<strong>${escape(enquiry.name)}</strong>` +
        (enquiry.address ? `<br>${escape(enquiry.address)}` : '') +
        (enquiry.phone ? `<br><a href="tel:${escape(enquiry.phone.replace(/[^\d+]/g, ''))}">${escape(enquiry.phone)}</a>` : '') +
        (enquiry.requestedOn ? `<br><span class="visit-popup-waiting">${waiting(enquiry.requestedOn)}</span>` : '')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'visit-popup-plan'
      button.textContent = 'Termin eintragen'
      button.addEventListener('click', () => plan.current(enquiry.siteId))
      popup.append(button)
      dot(enquiry.latitude, enquiry.longitude, OPEN)
        .bindTooltip(escape(enquiry.name), { permanent: true, direction: 'right', offset: [8, 0], className: 'visit-tag open' })
        .bindPopup(popup)
        .addTo(layer.current)
    }

    // The branches do not count for what is in sight: the customers do.
    for (const branch of branches) L.marker([branch.latitude, branch.longitude], { icon: star, keyboard: false, interactive: false, pane: 'branches' }).addTo(layer.current)

    if (points.length === 1) map.current.setView(points[0], 15)
    else if (points.length > 1) map.current.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 })
  }, [enquiries, visits, branches])

  return (
    <>
      <div className="visit-legend">
        <span><span className="visit-legend-dot" style={{ background: OPEN }} />offen ({enquiries.length})</span>
        <span><span className="visit-legend-dot" style={{ background: AGREED }} />vereinbart ({visits.length})</span>
        <span><span className="visit-legend-star">★</span>WEGO</span>
      </div>
      <div ref={element} className="visit-map" role="region" aria-label="Karte der Besichtigungen" />
    </>
  )
}
