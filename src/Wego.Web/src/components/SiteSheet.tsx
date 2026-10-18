import { Button, Group, Stack, Text } from '@mantine/core'
import type { Site } from '../api/types'
import { formatDate } from '../lib/dates'
import { formatAddress } from '../lib/sites'
import { Sheet } from './Sheet'
import { SiteLocation } from './SiteLocation'
import { StatusBadge } from './SiteStatus'

interface Props {
  site: Site
  canEdit: boolean
  /** Offer the jump to the page of the site (not from inside a dialog, which would close it). */
  showPageLink?: boolean
  onEdit: () => void
  onClose: () => void
}

/** The record of a construction site, opened from a cell of the plan. */
export function SiteSheet({ site, canEdit, showPageLink = true, onEdit, onClose }: Props) {
  const address = formatAddress(site)
  return (
    <Sheet onClose={onClose} title={<Text fw={700}>{site.name}</Text>} size="md">
      <Stack gap="sm">
        <StatusBadge status={site.status} />
        <div>
          <Text size="xs" c="dimmed">
            Auftraggeber
          </Text>
          <Text>{site.client ?? '–'}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Adresse
          </Text>
          {address ? <SiteLocation location={address} /> : <Text>–</Text>}
        </div>
        {(site.plannedStart || site.plannedEnd) && (
          <div>
            <Text size="xs" c="dimmed">
              Geplant
            </Text>
            <Text>
              {site.plannedStart ? formatDate(site.plannedStart) : '?'} – {site.plannedEnd ? formatDate(site.plannedEnd) : '?'}
            </Text>
          </div>
        )}
        {site.description && (
          <div>
            <Text size="xs" c="dimmed">
              Beschreibung
            </Text>
            <Text style={{ whiteSpace: 'pre-wrap' }}>{site.description}</Text>
          </div>
        )}
        <Group justify="flex-end" gap="xs">
          {canEdit && (
            <>
              {showPageLink && (
                <Button variant="default" component="a" href={`#/baustellen/${site.id}`} onClick={onClose}>
                  Baustelle öffnen
                </Button>
              )}
              <Button variant="light" onClick={onEdit}>
                Bearbeiten
              </Button>
            </>
          )}
          <Button onClick={onClose}>Schließen</Button>
        </Group>
      </Stack>
    </Sheet>
  )
}
