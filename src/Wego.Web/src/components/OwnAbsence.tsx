import { Alert, Button, Group, Paper, SegmentedControl, Stack, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useState } from 'react'
import { api, ApiError, messageOf } from '../api/client'
import { todayIso } from '../lib/dates'
import { useIsPhone } from '../lib/useIsPhone'

/**
 * Mein Bereich, for Planer G: his own vacation (or sickness) entered by himself, from a day to a day (the working
 * days of it). It is in his row of the plan then, and he is away for visits and meetings.
 */
export function OwnAbsence({ employeeId, onSaved }: { employeeId: number; onSaved: () => void }) {
  const isPhone = useIsPhone()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<'Urlaub' | 'Krank'>('Urlaub')
  const [range, setRange] = useState<[string | null, string | null]>([null, null])
  const [conflict, setConflict] = useState('')
  const [error, setError] = useState('')

  const save = async (force: boolean) => {
    const [from, to] = range
    if (!from) return
    setError('')
    try {
      const result = await api.saveAbsence({ employeeId, type, from, to: to ?? from, force })
      notifications.show({ message: `${type} eingetragen: ${result.days} ${result.days === 1 ? 'Arbeitstag' : 'Arbeitstage'}.`, color: 'teal' })
      setOpen(false)
      setRange([null, null])
      setConflict('')
      onSaved()
    } catch (e) {
      // Planned on those days: said first, saved only when confirmed.
      if (e instanceof ApiError && e.status === 409) setConflict(messageOf(e))
      else setError(messageOf(e))
    }
  }

  if (!open)
    return <Button variant="light" mb="md" onClick={() => setOpen(true)}>+ Urlaub eintragen</Button>

  return (
    <Paper withBorder radius="md" p="md" mb="md">
      <Stack gap="sm">
        <Text fw={700}>Eigene Abwesenheit eintragen</Text>
        <SegmentedControl value={type} onChange={(value) => setType(value as 'Urlaub' | 'Krank')}
          data={[{ value: 'Urlaub', label: 'Urlaub' }, { value: 'Krank', label: 'Krank' }]} />
        <DatePickerInput type="range" label="Von – bis" valueFormat="DD.MM.YYYY" allowSingleDateInRange
          minDate={type === 'Urlaub' ? new Date(todayIso()) : undefined}
          value={range} onChange={(value) => { setRange(value as [string | null, string | null]); setConflict('') }}
          dropdownType={isPhone ? 'modal' : 'popover'} />
        <Text size="xs" c="dimmed">Es zählen nur die Arbeitstage; Feiertage und Wochenenden bleiben frei.</Text>
        {error && <Alert color="red" variant="light">{error}</Alert>}
        {conflict ? (
          <Alert color="orange" variant="light">
            <Text size="sm" mb="xs">{conflict}</Text>
            <Group gap="xs">
              <Button size="compact-sm" color="orange" onClick={() => save(true)}>Trotzdem eintragen</Button>
              <Button size="compact-sm" variant="default" onClick={() => setConflict('')}>Abbrechen</Button>
            </Group>
          </Alert>
        ) : (
          <Group gap="xs">
            <Button disabled={!range[0]} onClick={() => save(false)}>Eintragen</Button>
            <Button variant="default" onClick={() => setOpen(false)}>Abbrechen</Button>
          </Group>
        )}
      </Stack>
    </Paper>
  )
}
