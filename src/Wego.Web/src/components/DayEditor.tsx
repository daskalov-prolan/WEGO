import {
  Alert,
  Button,
  Checkbox,
  CloseButton,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { useState, type FormEvent } from 'react'
import { messageOf } from '../api/client'
import type { Activity, DayEntryInput, Entry, EntryType, NamedItem, PlanEmployee, Site, SiteInput } from '../api/types'
import { allowedActivities } from '../lib/activities'
import { formatDateLong } from '../lib/dates'
import { ActivitySelect } from './ActivityPicker'
import { Sheet } from './Sheet'
import { SitePicker } from './SitePicker'

interface Props {
  employee: PlanEmployee
  date: string
  entries: Entry[]
  sites: Site[]
  onCreateSite: (input: SiteInput) => Promise<Site>
  onUpdateSite: (id: number, input: SiteInput) => Promise<Site>
  /** Sites of the weeks around this day, offered as one-tap buttons. */
  recentSites: NamedItem[]
  onClose: () => void
  /** Saves the day; a rejected promise keeps the editor open and shows the message. */
  onSave: (entries: DayEntryInput[]) => Promise<void>
  onCopy: (entries: DayEntryInput[]) => void
}

interface Row {
  type: EntryType
  siteId: number | null
  activity: Activity | null
  start: string
  end: string
  note: string
  important: boolean
}

const emptyRow = (type: EntryType, siteId: number | null = null, activity: Activity | null = null): Row => ({
  type,
  siteId,
  activity: type === 'Baustelle' ? activity : null,
  start: '',
  end: '',
  note: '',
  important: false,
})

function toInputs(rows: Row[]): DayEntryInput[] {
  return rows.map((row) => ({
    type: row.type,
    siteId: row.type === 'Baustelle' ? row.siteId : null,
    activity: row.type === 'Baustelle' ? row.activity : null,
    startTime: row.start ? `${row.start}:00` : null,
    endTime: row.end ? `${row.end}:00` : null,
    note: row.note.trim() || null,
    noteImportant: row.important && row.note.trim() !== '',
  }))
}

/** Edits all entries of one employee on one day. Several rows with time windows make a split day. */
export function DayEditor(props: Props) {
  const { employee, date, entries, sites, onCreateSite, onUpdateSite, recentSites, onClose, onSave, onCopy } = props
  // A new site row starts with what the employee typically does.
  const main = employee.mainActivity
  const allowed = allowedActivities(employee)
  const [rows, setRows] = useState<Row[]>(() =>
    entries.length === 0
      ? [emptyRow('Baustelle', null, main)]
      : entries.map((e) => ({
          type: e.type,
          siteId: e.siteId,
          activity: e.activity,
          start: e.startTime?.slice(0, 5) ?? '',
          end: e.endTime?.slice(0, 5) ?? '',
          note: e.note ?? '',
          important: e.noteImportant,
        })),
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (index: number, change: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)))

  // A recent site fills the first empty site row, or becomes an additional one.
  const pick = (siteId: number) =>
    setRows((current) => {
      const index = current.findIndex((row) => row.type === 'Baustelle' && row.siteId === null)
      if (index >= 0) return current.map((row, i) => (i === index ? { ...row, siteId } : row))
      return [...current.filter((row) => row.type === 'Baustelle'), emptyRow('Baustelle', siteId, main)]
    })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSave(toInputs(rows))
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  return (
    <Sheet
      onClose={onClose}
      title={
        <Text fw={700}>
          {employee.name} · {formatDateLong(date)}
        </Text>
      }
    >
      <form onSubmit={submit}>
        <Stack gap="sm">
          {recentSites.length > 0 && (
            <div>
              <Text size="xs" c="dimmed" mb={4}>
                Baustellen dieser Wochen
              </Text>
              <Group gap={6}>
                {recentSites.map((site) => (
                  <button
                    type="button"
                    key={site.id}
                    className="site-pick"
                    onClick={() => pick(site.id)}
                  >
                    {site.name}
                  </button>
                ))}
              </Group>
            </div>
          )}

          {rows.length === 0 && (
            <Text c="dimmed" size="sm">
              Keine Einträge. Speichern leert diesen Tag.
            </Text>
          )}

          {rows.map((row, index) => (
            <Paper withBorder p="sm" key={index}>
              <Stack gap="xs">
                <Group justify="space-between" wrap="nowrap">
                  <SegmentedControl
                    size="xs"
                    value={row.type}
                    onChange={(value) =>
                      update(index, {
                        type: value as EntryType,
                        activity: value === 'Baustelle' ? (row.activity ?? main) : null,
                      })
                    }
                    data={['Baustelle', 'Urlaub', 'Krank']}
                  />
                  <CloseButton
                    aria-label={`Eintrag ${index + 1} entfernen`}
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                  />
                </Group>
                {row.type === 'Baustelle' && (
                  <SitePicker
                    sites={sites}
                    value={row.siteId}
                    onChange={(siteId) => update(index, { siteId })}
                    onCreate={onCreateSite}
                    onUpdate={onUpdateSite}
                    required
                  />
                )}
                {row.type === 'Baustelle' && (
                  <ActivitySelect
                    value={row.activity}
                    onChange={(activity) => update(index, { activity })}
                    allowed={allowed}
                    main={main}
                  />
                )}
                <Group grow gap="xs">
                  <TextInput
                    label="von"
                    type="time"
                    value={row.start}
                    onChange={(e) => update(index, { start: e.currentTarget.value })}
                  />
                  <TextInput
                    label="bis"
                    type="time"
                    value={row.end}
                    onChange={(e) => update(index, { end: e.currentTarget.value })}
                  />
                </Group>
                <Group gap="sm" align="flex-end" wrap="nowrap">
                  <TextInput
                    label="Notiz"
                    placeholder="z. B. mit 2 Helfern"
                    value={row.note}
                    onChange={(e) => update(index, { note: e.currentTarget.value })}
                    maxLength={500}
                    style={{ flex: 1 }}
                  />
                  <Checkbox
                    label="Sehr wichtig"
                    color="red"
                    mb={8}
                    disabled={row.note.trim() === ''}
                    checked={row.important && row.note.trim() !== ''}
                    onChange={(e) => update(index, { important: e.currentTarget.checked })}
                  />
                </Group>
              </Stack>
            </Paper>
          ))}

          <Group gap="xs">
            <Button size="xs" variant="light" onClick={() => setRows([...rows, emptyRow('Baustelle', null, main)])}>
              + Baustelle
            </Button>
            <Button size="xs" variant="light" color="green" onClick={() => setRows([emptyRow('Urlaub')])}>
              Urlaub
            </Button>
            <Button size="xs" variant="light" color="red" onClick={() => setRows([emptyRow('Krank')])}>
              Krank
            </Button>
            <Button size="xs" variant="subtle" color="gray" onClick={() => setRows([])}>
              Tag leeren
            </Button>
            <Button size="xs" variant="subtle" color="gray" onClick={() => onCopy(toInputs(rows))}>
              Kopieren
            </Button>
          </Group>

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" loading={busy}>
              Speichern
            </Button>
          </Group>
        </Stack>
      </form>
    </Sheet>
  )
}
