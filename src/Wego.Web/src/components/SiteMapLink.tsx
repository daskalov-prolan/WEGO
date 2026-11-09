import { Button, Modal, Text } from '@mantine/core'
import { lazy, Suspense, useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Site, SiteMapLocation } from '../api/types'

/** The map (Leaflet) is loaded only when one is opened: the app starts without it. */
export const LazySitesMap = lazy(() => import('./SitesMap').then((module) => ({ default: module.SitesMap })))

/** "Auf Karte anzeigen": the site alone on the map, in a window on top. */
export function SiteMapLink({ site, size = 'compact-xs' }: { site: Site; size?: string }) {
  const [open, setOpen] = useState(false)
  const [location, setLocation] = useState<SiteMapLocation | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    api.siteLocation(site.id).then(setLocation, (e) => setError(messageOf(e)))
  }, [open, site.id])

  if (!site.street) return null
  return (
    <>
      <Button
        size={size}
        color="wegoRed.6"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => {
          setError('')
          setOpen(true)
        }}
      >
        Auf Karte anzeigen
      </Button>
      {open && (
        <Modal opened onClose={() => setOpen(false)} title={site.name} size="xl" centered>
          {error ? (
            <Text c="red">{error}</Text>
          ) : location ? (
            <Suspense fallback={<Text c="dimmed">Die Karte wird geladen …</Text>}>
              <LazySitesMap points={[{ site, location }]} height={420} linkToPage={false} />
            </Suspense>
          ) : (
            <Text c="dimmed">Die Adresse wird auf der Karte gesucht …</Text>
          )}
        </Modal>
      )}
    </>
  )
}
