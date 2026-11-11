import { Badge, Button, Group, Stack, Text } from '@mantine/core'
import type { Entry, NamedItem, SchoolHoliday, Site } from '../api/types'
import { formatAddress } from '../lib/sites'
import { entryStyle } from '../lib/activities'
import { formatDateLong } from '../lib/dates'
import { Chip } from './Chip'
import { Sheet } from './Sheet'
import { CallButton, SiteWayButtons } from './SiteActions'

interface Props {
  employee: NamedItem
  date: string
  entries: Entry[]
  holiday?: SchoolHoliday
  siteById: Map<number, Site>
  onClose: () => void
}

/** Read-only view of one employee's day, for everybody who may not change the plan. */
export function DayDetails({ employee, date, entries, holiday, siteById, onClose }: Props) {
  return (
    <Sheet onClose={onClose} title={<Text fw={700}>{employee.name}</Text>} size="md">
      <Stack gap="sm">
        <Group gap="xs">
          <Text c="dimmed">{formatDateLong(date)}</Text>
          {holiday && (
            <Badge color="green" variant={holiday.kind === 'Feiertag' ? 'filled' : 'light'}>
              {holiday.name}
            </Badge>
          )}
        </Group>
        {entries.length === 0 && <Text>Nicht eingeplant.</Text>}
        {/* Each appointment a card of its own, edged in its colour and numbered when there are several. */}
        {entries.map((entry, index) => {
          const site = entry.siteId === null ? undefined : siteById.get(entry.siteId)
          const address = site && formatAddress(site)
          return (
            <div key={entry.id} className="day-details-entry" style={entryStyle(entry)}>
              {entries.length > 1 && (
                <Text size="xs" fw={700} c="dimmed" className="day-details-count">
                  Termin {index + 1} von {entries.length}
                </Text>
              )}
              <Chip entry={entry} withActivity />
              {address && <Text size="sm">{address}</Text>}
              {site && (
                <Group gap="xs">
                  <SiteWayButtons site={site} size="xs" />
                  {site.clientPhone && <CallButton phone={site.clientPhone} size="xs" />}
                </Group>
              )}
            </div>
          )
        })}
        <Group justify="flex-end">
          <Button onClick={onClose}>Schließen</Button>
        </Group>
      </Stack>
    </Sheet>
  )
}
