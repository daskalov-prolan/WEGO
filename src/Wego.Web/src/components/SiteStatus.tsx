import { Badge, Button, Group, Popover, SegmentedControl, Table, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Site, SiteStatus, StatusChange } from '../api/types'
import { nextStatuses, SITE_STATUSES } from '../lib/activities'

const ACTION: Record<SiteStatus, string> = {
  Angebot: 'Zur Angebotsphase',
  Bauphase: 'Bauphase beginnen',
  Abgeschlossen: 'Erledigt',
  Storniert: 'Stornieren',
}

export function StatusBadge({ status }: { status: SiteStatus }) {
  const info = SITE_STATUSES.find((candidate) => candidate.value === status)!
  return (
    // Bauphase in the full signal red of the logo, the others light.
    <Badge color={info.color} variant={status === 'Bauphase' ? 'filled' : 'light'}>
      {info.label}
    </Badge>
  )
}

/**
 * Bauphase or Erledigt as one slider of two fields of the same size: on the page of a site and in the list
 * of sites ("Setze auf erledigt") alike.
 */
export function StatusSlider({
  site,
  onChange,
  size = 'sm',
}: {
  site: Site
  onChange: (status: SiteStatus) => void
  size?: 'xs' | 'sm'
}) {
  const done = site.status === 'Abgeschlossen'
  return (
    <SegmentedControl
      size={size}
      w={size === 'xs' ? 200 : 230}
      fullWidth
      radius="xl"
      // A slider: a sunk track, the coloured part lifted with a knob at its inner edge (see .status-slider).
      className={done ? 'status-slider done' : 'status-slider'}
      color={done ? 'green' : 'wegoRed'}
      aria-label={`${site.name}: Bauphase oder erledigt`}
      value={done ? 'Abgeschlossen' : 'Bauphase'}
      data={[
        { value: 'Bauphase', label: 'Bauphase' },
        { value: 'Abgeschlossen', label: 'Erledigt' },
      ]}
      onClick={(event) => event.stopPropagation()}
      onChange={(value) => onChange(value as SiteStatus)}
    />
  )
}

interface Props {
  site: Site
  canEdit: boolean
  onChanged: (site: Site) => void
}

/** Status of a site with the allowed next steps in one line; the log of all changes with date behind "Verlauf". */
export function SiteStatusPanel({ site, canEdit, onChanged }: Props) {
  const [history, setHistory] = useState<StatusChange[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (canEdit) api.siteHistory(site.id).then(setHistory, (e) => setError(messageOf(e)))
  }, [site.id, site.status, canEdit])

  const change = async (status: SiteStatus) => {
    if (!window.confirm(`„${site.name}“: ${ACTION[status]}?`)) return
    try {
      onChanged(await api.changeSiteStatus(site.id, status))
      setError('')
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <div>
      <Group gap={6} align="center" wrap="nowrap">
        {/* In the construction phase or done: the slider between both; else the status and its next steps. */}
        {canEdit && (site.status === 'Bauphase' || site.status === 'Abgeschlossen') ? (
          <StatusSlider site={site} onChange={(status) => change(status)} />
        ) : (
          <StatusBadge status={site.status} />
        )}
        {canEdit &&
          site.status !== 'Bauphase' &&
          site.status !== 'Abgeschlossen' &&
          nextStatuses(site.status).map((status) => (
            <Button
              key={status}
              size="compact-sm"
              variant="light"
              onClick={() => change(status)}
            >
              {site.status === 'Abgeschlossen' && status === 'Bauphase' ? 'Zurück in die Bauphase' : ACTION[status]}
            </Button>
          ))}
        {canEdit && history.length > 0 && (
          <Popover position="bottom-start" withArrow shadow="md">
            <Popover.Target>
              <Button size="compact-sm" variant="subtle" color="gray">
                Verlauf
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <StatusHistory history={history} />
            </Popover.Dropdown>
          </Popover>
        )}
      </Group>
      {error && (
        <Text c="red" size="sm" mt={4}>
          {error}
        </Text>
      )}
    </div>
  )
}

function StatusHistory({ history }: { history: StatusChange[] }) {
  return (
    <>
      {history.length > 0 && (
        <Table withRowBorders={false} verticalSpacing={2} fz="sm" className="status-history">
          <Table.Tbody>
            {history.map((entry, index) => (
              <Table.Tr key={index}>
                <Table.Td c="dimmed" w={150}>
                  {new Date(entry.changedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}
                </Table.Td>
                <Table.Td>
                  {entry.from ? `${entry.from} → ${entry.to}` : `angelegt als ${entry.to}`}
                </Table.Td>
                <Table.Td c="dimmed">{entry.changedBy}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </>
  )
}
