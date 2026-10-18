import { Badge, Button, Group, Stack, Text } from '@mantine/core'
import type { Customer, Entry, NamedItem, SchoolHoliday } from '../api/types'
import { formatDateLong } from '../lib/dates'
import { Chip } from './Chip'
import { Sheet } from './Sheet'
import { SiteLocation } from './SiteLocation'

interface Props {
  employee: NamedItem
  date: string
  entries: Entry[]
  holiday?: SchoolHoliday
  siteById: Map<number, Customer>
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
        {entries.map((entry) => {
          const site = entry.customerId === null ? undefined : siteById.get(entry.customerId)
          return (
            <div key={entry.id} className="day-details-entry">
              <Chip entry={entry} withActivity />
              {site?.location && <SiteLocation location={site.location} />}
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
