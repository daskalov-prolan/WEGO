import { Button } from '@mantine/core'
import { lazy } from 'react'
import type { Site } from '../api/types'
import { formatAddress } from '../lib/sites'

/** The map (Leaflet) is loaded only when one is opened: the app starts without it. */
export const LazySitesMap = lazy(() => import('./SitesMap').then((module) => ({ default: module.SitesMap })))

/** "Auf Karte anzeigen": the address of the site on Google Maps, in a new tab (free, no key needed). */
export function SiteMapLink({ site, size = 'compact-xs' }: { site: Site; size?: string }) {
  const address = formatAddress(site)
  if (!site.street || !address) return null
  return (
    <Button
      component="a"
      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
      target="_blank"
      rel="noreferrer"
      size={size}
      style={{ alignSelf: 'flex-start' }}
    >
      Auf Karte anzeigen
    </Button>
  )
}
