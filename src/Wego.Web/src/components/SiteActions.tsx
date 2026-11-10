import { Button, Group, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import type { MouseEvent } from 'react'
import type { Site } from '../api/types'
import { formatAddress } from '../lib/sites'
import { SiteMapLink } from './SiteMapLink'

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

/** A phone can dial: a computer at the desk (a laptop with a touch screen too) has no use for a button that calls. */
export const useCanCall = () => useMediaQuery('(max-width: 720px) and (pointer: coarse)')

/** The telephone number of the customer written out, on a phone with a button beside it that dials it. */
export function CallButton({ phone, size = 'sm' }: { phone: string; size?: string }) {
  const canCall = useCanCall()
  return (
    <Group gap={8} wrap="nowrap" className="call" onClick={own}>
      <Text component="span" size="sm" className="call-number">
        {phone}
      </Text>
      {canCall && (
        <Button component="a" href={callHref(phone)} size={size} aria-label={`Anrufen: ${phone}`}>
          Anrufen
        </Button>
      )}
    </Group>
  )
}
