import { Badge, Group, Modal, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import type { Entry, Plan, Site } from '../api/types'
import { SiteName } from './Chip'
import { activityLabel, entryStyle } from '../lib/activities'
import { formatDate, formatDateLong, formatDayTime } from '../lib/dates'
import { clientName, formatAddress } from '../lib/sites'
import { CallButton, SiteWayButtons } from './SiteActions'

interface Props {
  /** The entry tapped: its day, time and note. */
  entry: Entry
  site: Site
  plan: Plan
  /** The craftsman looking at it. */
  employeeId: number
  /** Who else is there that day, as shown on the tile. */
  colleagues: string[]
  onClose: () => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="my-site-row">
      <Text size="xs" fw={700} c="dimmed" tt="uppercase">
        {label}
      </Text>
      {children}
    </div>
  )
}

/**
 * Everything a craftsman needs about a site, from a tap on it in "Mein Plan": where it is (with the way there),
 * whom to call, what is to do, who else is there and on which days he works there.
 */
export function MySiteDetails({ entry, site, plan, employeeId, colleagues, onClose }: Props) {
  const small = useMediaQuery('(max-width: 600px)')
  const address = formatAddress(site)
  const planner = [...(plan.planners ?? []), ...plan.employees].find((p) => p.id === site.responsiblePlannerId)
  const myDays = plan.entries
    .filter((e) => e.employeeId === employeeId && e.siteId === site.id)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))

  return (
    <Modal opened onClose={onClose} fullScreen={small} size="lg" title={
        <Text fw={800} size="lg" className="my-site-title">
          <SiteName name={site.name} activity={entry.activity} />
        </Text>
      }>
      <Stack gap="md">
        <div className="my-entry" style={entryStyle(entry)}>
          <span className="when">
            {formatDateLong(entry.date)} · {formatDayTime(entry)}
          </span>
          {entry.activity && <span className="what">{activityLabel(entry.activity)}</span>}
          {entry.note && (
            <span className={entry.noteImportant ? 'detail important' : 'detail'}>
              {entry.noteImportant && <strong className="important-mark">! </strong>}
              {entry.note}
            </span>
          )}
          <span className="detail">{colleagues.length > 0 ? `mit ${colleagues.join(', ')}` : 'allein'}</span>
        </div>

        {address && (
          <Row label="Adresse">
            <Text fw={600}>{address}</Text>
            <Group mt={6}>
              <SiteWayButtons site={site} />
            </Group>
          </Row>
        )}

        {(site.client || site.clientPhone) && (
          <Row label="Kunde">
            {site.client && <Text fw={600}>{clientName(site)}</Text>}
            {site.clientPhone && (
              <Group mt={6}>
                <CallButton phone={site.clientPhone} />
              </Group>
            )}
          </Row>
        )}

        {site.description && (
          <Row label="Was ist zu tun">
            <Text className="site-description" style={{ whiteSpace: 'pre-line' }}>
              {site.description}
            </Text>
          </Row>
        )}

        <Group gap="xl" align="flex-start">
          {/* No end is planned, only the start. */}
          {site.plannedStart && (
            <Row label="Baubeginn">
              <Text>{formatDate(site.plannedStart)}</Text>
            </Row>
          )}
          {site.labelProjectNumber && (
            <Row label="Projekt-Nr.">
              <Text>{site.labelProjectNumber}</Text>
            </Row>
          )}
          {planner && (
            <Row label="Zuständiger Planer">
              <Text>{planner.name}</Text>
            </Row>
          )}
        </Group>

        <Row label={`Meine Tage hier (${new Set(myDays.map((d) => d.date)).size})`}>
          <Stack gap={4} mt={4}>
            {myDays.map((day) => (
              <Group key={day.id} gap="xs" wrap="nowrap" className={day.id === entry.id ? 'my-site-day current' : 'my-site-day'}>
                <Text size="sm" fw={day.id === entry.id ? 800 : 500} style={{ minWidth: 150 }}>
                  {formatDateLong(day.date)}
                </Text>
                <Text size="sm">{formatDayTime(day)}</Text>
                {day.activity && (
                  <Badge size="sm" variant="light" color="gray">
                    {activityLabel(day.activity)}
                  </Badge>
                )}
              </Group>
            ))}
          </Stack>
        </Row>
      </Stack>
    </Modal>
  )
}
