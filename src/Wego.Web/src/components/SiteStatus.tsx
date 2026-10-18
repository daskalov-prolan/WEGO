import { Badge, Button, Group, Popover, Table, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Site, SiteStatus, StatusChange } from '../api/types'
import { nextStatuses, SITE_STATUSES } from '../lib/activities'

const ACTION: Record<SiteStatus, string> = {
  Angebot: 'Zum Angebot',
  Bauphase: 'Bauphase beginnen',
  Abgeschlossen: 'Abschließen',
  Storniert: 'Stornieren',
}

export function StatusBadge({ status }: { status: SiteStatus }) {
  const info = SITE_STATUSES.find((candidate) => candidate.value === status)!
  return (
    <Badge color={info.color} variant="light">
      {info.label}
    </Badge>
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
        <StatusBadge status={site.status} />
        {canEdit &&
          nextStatuses(site.status).map((status) => (
            <Button
              key={status}
              size="compact-sm"
              variant={status === 'Storniert' ? 'subtle' : 'light'}
              color={status === 'Storniert' ? 'red' : undefined}
              onClick={() => change(status)}
            >
              {ACTION[status]}
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
