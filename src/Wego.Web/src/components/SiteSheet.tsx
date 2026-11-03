import { Button, Group, Stack, Text } from '@mantine/core'
import type { Site } from '../api/types'
import { Sheet } from './Sheet'
import { SiteSummary } from './SiteSummary'

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
  return (
    <Sheet onClose={onClose} title={<Text fw={700}>{site.name}</Text>} size="md">
      <Stack gap="sm">
        <SiteSummary site={site} />
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
