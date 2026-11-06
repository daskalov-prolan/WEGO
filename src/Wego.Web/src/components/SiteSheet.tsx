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
  // The name of the customer leads to the page of the site, for those who may open it.
  const page = canEdit && showPageLink ? `#/baustellen/${site.id}` : undefined
  return (
    <Sheet
      onClose={onClose}
      title={
        page ? (
          <Text fw={700} component="a" href={page} onClick={onClose} className="site-sheet-title">
            {site.name}
          </Text>
        ) : (
          <Text fw={700}>{site.name}</Text>
        )
      }
      size="md"
    >
      <Stack gap="sm">
        <SiteSummary site={site} clientHref={page} />
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
