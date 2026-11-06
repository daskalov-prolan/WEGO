import { Button, Group } from '@mantine/core'
import type { MouseEvent } from 'react'
import type { Site } from '../api/types'
import { formatAddress } from '../lib/sites'
import { SiteMapLink } from './SitesMap'

/** The number to dial: only digits and the plus. */
export const callHref = (phone: string) => `tel:${phone.replace(/[^+0-9]/g, '')}`

// Inside a card that opens on a click, the button does its own thing only.
const own = (event: MouseEvent) => event.stopPropagation()

/**
 * The way to a site, everywhere the same as in the record of a site in "Mein Plan": the navigation of the
 * phone to the address, and the site on the map. Nothing without an address.
 */
export function SiteWayButtons({ site, size = 'sm' }: { site: Site; size?: string }) {
  const address = formatAddress(site)
  if (!address) return null
  return (
    <Group gap="xs" onClick={own}>
      <Button
        component="a"
        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
        target="_blank"
        rel="noreferrer"
        size={size}
      >
        Navigation starten
      </Button>
      <SiteMapLink site={site} size={size} />
    </Group>
  )
}

/** The telephone number of the customer as a button that dials it, as in "Mein Plan". */
export function CallButton({ phone, size = 'sm' }: { phone: string; size?: string }) {
  return (
    <Button component="a" href={callHref(phone)} size={size} onClick={own} style={{ alignSelf: 'flex-start' }}>
      Anrufen: {phone}
    </Button>
  )
}
