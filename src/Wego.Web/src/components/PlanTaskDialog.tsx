import { Alert, Button, Group, MultiSelect, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { messageOf } from '../api/client'
import type { Activity, PlanEmployee, Site } from '../api/types'
import { activityLabel } from '../lib/activities'
import { formatDateLong } from '../lib/dates'
import { ActivityIcon } from './ActivityIcon'
import { Sheet } from './Sheet'

interface Props {
  site: Site
  activity: Activity
  date: string
  /** Who can do the activity on this site. */
  employees: PlanEmployee[]
  onClose: () => void
  onPlan: (employeeIds: number[]) => Promise<void>
}

/** An open activity was dropped on a day of a site: asks who goes there. */
export function PlanTaskDialog({ site, activity, date, employees, onClose, onPlan }: Props) {
  const [chosen, setChosen] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const plan = async () => {
    setBusy(true)
    setError('')
    try {
      await onPlan(chosen.map(Number))
      onClose()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      onClose={onClose}
      size="sm"
      title={
        <Group gap={6} wrap="nowrap">
          <ActivityIcon activity={activity} size={14} />
          <Text fw={700}>{activityLabel(activity)} einplanen</Text>
        </Group>
      }
    >
      <Stack gap="sm">
        <Text size="sm">
          {site.name} · {formatDateLong(date)}
        </Text>
        {employees.length === 0 ? (
          <Text size="sm" c="dimmed">
            Niemand hat diese Tätigkeit. Bitte in der Verwaltung beim Mitarbeiter zuordnen.
          </Text>
        ) : (
          <MultiSelect
            label="Mitarbeiter"
            placeholder={chosen.length ? undefined : 'wer?'}
            data={employees.map((employee) => ({ value: String(employee.id), label: employee.name }))}
            value={chosen}
            onChange={setChosen}
            searchable
            // The list opens upwards: the button below stays free to use.
            comboboxProps={{ position: 'top' }}
            data-autofocus
          />
        )}
        {error && (
          <Alert color="red" variant="light" p="xs">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={busy} disabled={chosen.length === 0} onClick={plan}>
            Einplanen
          </Button>
        </Group>
      </Stack>
    </Sheet>
  )
}
