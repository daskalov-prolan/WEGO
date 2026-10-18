import { Alert, Button, Group, MultiSelect, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { messageOf } from '../api/client'
import type { Entry, PlanEmployee, Site } from '../api/types'
import { formatDateLong } from '../lib/dates'
import { Chip } from './Chip'
import { Sheet } from './Sheet'

interface Props {
  site: Site
  date: string
  /** The entries at this site on this day. */
  entries: Entry[]
  employees: PlanEmployee[]
  canEdit: boolean
  onClose: () => void
  onOpenSite: () => void
  /** Opens the whole day of one employee in the day editor. */
  onEditDay?: (employee: PlanEmployee) => void
  /** Puts these employees on the site, each with their own main activity. */
  onAdd: (employeeIds: number[]) => Promise<void>
  onRemove: (entry: Entry) => Promise<void>
}

/** One day of a construction site: who works there, and for planners who else should go. */
export function SiteDayDialog(props: Props) {
  const { site, date, entries, employees, canEdit, onClose, onOpenSite, onEditDay, onAdd, onRemove } = props
  const [adding, setAdding] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const present = new Set(entries.map((entry) => entry.employeeId))
  const others = employees.filter((employee) => !present.has(employee.id))

  return (
    <Sheet
      onClose={onClose}
      title={
        <Text fw={700}>
          <span className="site-link" role="link" onClick={onOpenSite}>
            {site.name}
          </span>{' '}
          · {formatDateLong(date)}
        </Text>
      }
      size="md"
    >
      <Stack gap="sm">
        {entries.length === 0 && <Text c="dimmed">An diesem Tag ist niemand eingeplant.</Text>}
        {entries.map((entry) => {
          const employee = employees.find((candidate) => candidate.id === entry.employeeId)
          return (
            <Group key={entry.id} justify="space-between" wrap="nowrap" gap="xs">
              <div style={{ flex: 1, minWidth: 0 }}>
                <Chip entry={entry} label={entry.employeeName} withActivity />
                {!entry.activity && (
                  <Text size="xs" c="dimmed">
                    ohne Tätigkeit
                  </Text>
                )}
              </div>
              {canEdit && (
                <Group gap={4} wrap="nowrap">
                  {employee && onEditDay && (
                    <Button size="compact-sm" variant="default" onClick={() => onEditDay(employee)}>
                      Tag bearbeiten
                    </Button>
                  )}
                  <Button size="compact-sm" variant="subtle" color="red" loading={busy} onClick={() => run(() => onRemove(entry))}>
                    Entfernen
                  </Button>
                </Group>
              )}
            </Group>
          )
        })}

        {canEdit && others.length > 0 && (
          <Group align="flex-end" gap="xs" wrap="nowrap">
            <MultiSelect
              label="Weitere Mitarbeiter einplanen"
              description="Jeder mit seiner Haupttätigkeit; ändern im Tageseditor"
              placeholder={adding.length ? undefined : 'Mitarbeiter wählen'}
              value={adding}
              onChange={setAdding}
              data={others.map((employee) => ({ value: String(employee.id), label: employee.name }))}
              searchable
              style={{ flex: 1 }}
              comboboxProps={{ withinPortal: true }}
            />
            <Button
              disabled={adding.length === 0}
              loading={busy}
              onClick={() =>
                run(async () => {
                  await onAdd(adding.map(Number))
                  setAdding([])
                })
              }
            >
              Einplanen
            </Button>
          </Group>
        )}

        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button onClick={onClose}>Schließen</Button>
        </Group>
      </Stack>
    </Sheet>
  )
}
