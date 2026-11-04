import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  CloseButton,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { messageOf } from '../api/client'
import type { Activity, DayEntryInput, Entry, EntryType, PlanEmployee, Site, SiteInput } from '../api/types'
import { activityLabel, allowedActivities, defaultActivity, entryStyle, isFree, isOpen } from '../lib/activities'
import { formatDateLong, HALF_DAYS, WHOLE_DAY } from '../lib/dates'
import { emptySite } from '../lib/sites'
import { Sheet } from './Sheet'
import { SitePicker } from './SitePicker'
import { TimeSelect } from './TimeSelect'

interface Props {
  employee: PlanEmployee
  date: string
  entries: Entry[]
  sites: Site[]
  onCreateSite: (input: SiteInput) => Promise<Site>
  onUpdateSite: (id: number, input: SiteInput) => Promise<Site>
  /** Planners: goes to the page of a site (the day is left without saving). */
  onGoToSite?: (siteId: number) => void
  /** Urlaub and Krank are for Planer G: without it such a row stays as it is. */
  canAbsence?: boolean
  onClose: () => void
  /** Saves the day; a rejected promise keeps the editor open and shows the message. */
  onSave: (entries: DayEntryInput[]) => Promise<void>
  /** Puts the day on the clipboard of the plan; without it there is no copy button. */
  onCopy?: (entries: DayEntryInput[]) => void
  /** An activity dragged onto the day: added as a new row whose site is chosen (or created) here. */
  addActivity?: Activity
}

interface Row {
  type: EntryType
  siteId: number | null
  activity: Activity | null
  /** Kept free, no site: "verfügbar" (e.g. the other half of a split day). */
  free: boolean
  start: string
  end: string
  note: string
  important: boolean
}

const emptyRow = (type: EntryType, siteId: number | null = null, activity: Activity | null = null): Row => ({
  type,
  siteId,
  activity: type === 'Baustelle' ? activity : null,
  free: false,
  start: '',
  end: '',
  note: '',
  important: false,
})

function toInputs(rows: Row[]): DayEntryInput[] {
  return rows.map((row) => ({
    type: row.type,
    siteId: row.type === 'Baustelle' && !row.free ? row.siteId : null,
    activity: row.type === 'Baustelle' && !row.free ? row.activity : null,
    startTime: row.start ? `${row.start}:00` : null,
    endTime: row.end ? `${row.end}:00` : null,
    note: row.note.trim() || null,
    noteImportant: row.important && row.note.trim() !== '',
  }))
}

/** Edits all entries of one employee on one day. Several rows with time windows make a split day. */
export function DayEditor(props: Props) {
  const { employee, date, entries, sites, onCreateSite, onUpdateSite, onGoToSite, canAbsence = false, onClose, onSave, onCopy } = props
  // A new site row starts without an activity: it follows the site chosen.
  const main = null
  // The activities offered follow the status of an open site. On a done or cancelled site (entries from
  // before it was closed) the employee's own activities are offered, whatever the status was then.
  const statusOf = (siteId: number | null) => {
    const status = sites.find((site) => site.id === siteId)?.status
    return status && isOpen(status) ? status : undefined
  }
  const siteName = (siteId: number | null) => sites.find((site) => site.id === siteId)?.name
  // A site row is titled with its activity (there is no field for it: it comes from what was dragged in, the
  // employee and the site) and its site.
  const rowTitle = (row: Row) =>
    row.free
      ? 'verfügbar'
      : [activityLabel(row.activity), siteName(row.siteId) ?? (row.siteId === null ? 'Baustelle wählen oder neu anlegen' : null)]
      .filter(Boolean)
      .join(' · ')
  const [rows, setRows] = useState<Row[]>(() => {
    const saved = entries.map((e) => ({
      type: e.type,
      siteId: e.siteId,
      activity: e.activity,
      free: isFree(e),
      start: e.startTime?.slice(0, 5) ?? '',
      end: e.endTime?.slice(0, 5) ?? '',
      note: e.note ?? '',
      important: e.noteImportant,
    }))
    if (props.addActivity) return [...saved, emptyRow('Baustelle', null, props.addActivity)]
    return saved.length === 0 ? [emptyRow('Baustelle', null, main)] : saved
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // A site created here goes onto the day at once, with the activity of its row (e.g. the one dragged in):
  // saved as soon as the new site is in its row.
  const createdSite = useRef<number | null>(null)
  const createSite = async (input: SiteInput) => {
    const site = await onCreateSite(input)
    createdSite.current = site.id
    return site
  }

  const update = (index: number, change: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)))

  // Two entries change places; the time windows stay where they are (the morning stays the morning).
  const swap = (index: number) =>
    setRows((current) =>
      current.map((row, i) => {
        if (i !== index && i !== index + 1) return row
        const other = current[i === index ? index + 1 : index]
        return { ...other, start: row.start, end: row.end }
      }),
    )

  // Urlaub and Krank rows that may not be changed here (see canAbsence).
  const kept = (current: Row[]) => (canAbsence ? [] : current.filter((row) => row.type !== 'Baustelle'))

  // The day in two halves: the first two site rows get the times (a missing second row is added for the
  // next site); vacation or sick rows go (if allowed), half a day is work on sites.
  const splitDay = () =>
    setRows((current) => {
      const sites = current.filter((row) => row.type === 'Baustelle')
      while (sites.length < HALF_DAYS.length) sites.push(emptyRow('Baustelle', null, main))
      return [...kept(current), ...sites.map((row, i) => (i < HALF_DAYS.length ? { ...row, ...HALF_DAYS[i] } : row))]
    })

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await onSave(toInputs(rows))
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  // Runs after every change; saves once the rows hold a site just created.
  useEffect(() => {
    if (createdSite.current === null || !rows.some((row) => row.siteId === createdSite.current)) return
    createdSite.current = null
    void save()
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    // Only this form: a site form opened from here (a child in React) does not save the day.
    if (event.target !== event.currentTarget) return
    void save()
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
          {rows.length === 0 && (
            <Text c="dimmed" size="sm">
              Keine Einträge. Speichern leert diesen Tag.
            </Text>
          )}

          {rows.map((row, index) => [
            // Each entry in the colour of its activity (or of Urlaub / Krank), every second one a bit stronger,
            // and titled with its site, so the entries of a day stand apart.
            <Paper
              withBorder
              p="sm"
              key={index}
              className={index % 2 === 1 ? 'day-row second' : 'day-row'}
              // A row kept free in the green of "verfügbar".
              style={entryStyle(row.free ? { ...row, activity: null, siteName: null } : row)}
            >
              <Stack gap="xs">
                <Group justify="space-between" wrap="nowrap">
                  <Text fw={700} size="sm" className="day-row-title">
                    {index + 1} · {row.type === 'Baustelle' ? rowTitle(row) : row.type}
                  </Text>
                  {(row.type === 'Baustelle' || canAbsence) && (
                    <CloseButton
                      aria-label={`Eintrag ${index + 1} entfernen`}
                      onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    />
                  )}
                </Group>
                {/* A row without a site yet can stay free, e.g. the other half of the day. */}
                {row.type === 'Baustelle' && (row.free || row.siteId === null) && (
                  <Checkbox
                    label="Bleibt verfügbar (keine Baustelle)"
                    checked={row.free}
                    onChange={(e) => update(index, { free: e.currentTarget.checked, siteId: null })}
                  />
                )}
                {row.type === 'Baustelle' && !row.free && (
                  <SitePicker
                    sites={sites}
                    value={row.siteId}
                    onChange={(siteId) => {
                      // Another site may be in another status: keep the activity only if it fits there.
                      const status = statusOf(siteId)
                      const fits = row.activity !== null && allowedActivities(employee, status).includes(row.activity)
                      update(index, { siteId, activity: fits ? row.activity : defaultActivity(employee, status) })
                    }}
                    onCreate={createSite}
                    onUpdate={onUpdateSite}
                    onGoToSite={onGoToSite}
                    // A new site for the start of the construction (Abriss / Baubeginn) begins on this day.
                    newSite={row.activity === 'Abriss' ? { ...emptySite, plannedStart: date } : undefined}
                    // An offer visit can be planned before its site is known: then the activity is enough.
                    required={row.activity === null}
                  />
                )}
                <Group grow gap="xs">
                  <TimeSelect
                    label="von"
                    value={row.start}
                    // An end that is no longer after the start is chosen anew.
                    onChange={(start) => update(index, { start, ...(row.end && start && row.end <= start ? { end: '' } : {}) })}
                  />
                  <TimeSelect label="bis" value={row.end} onChange={(end) => update(index, { end })} after={row.start} />
                </Group>
                {/* Quick times: half a day in the morning or the afternoon, or the whole day (a half kept free goes then). */}
                <Group gap={6}>
                  {HALF_DAYS.map((half, i) => (
                    <Button
                      key={half.start}
                      size="compact-xs"
                      variant={row.start === half.start && row.end === half.end ? 'filled' : 'light'}
                      onClick={() => update(index, half)}
                    >
                      ½ Tag {i === 0 ? 'vormittags' : 'nachmittags'}
                    </Button>
                  ))}
                  {!row.free && (row.start !== WHOLE_DAY.start || row.end !== WHOLE_DAY.end) && (
                    <Button
                      size="compact-xs"
                      variant="light"
                      onClick={() =>
                        setRows((current) =>
                          current.filter((other, i) => i === index || !other.free).map((other) => (other === row ? { ...other, ...WHOLE_DAY } : other)),
                        )
                      }
                    >
                      Auf den ganzen Tag ausweiten
                    </Button>
                  )}
                </Group>
                <Group gap="sm" align="flex-end" wrap="nowrap">
                  <TextInput
                    label="Notiz"
                    placeholder="hier wichtige Hinweise oder Notizen eintragen"
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
            </Paper>,
            // Between two entries: change their order.
            index < rows.length - 1 && (
              <Group key={`swap-${index}`} justify="center" my={-6}>
                <Tooltip label="Reihenfolge tauschen (die Uhrzeiten bleiben)">
                  <ActionIcon variant="light" radius="xl" aria-label={`Eintrag ${index + 1} und ${index + 2} tauschen`} onClick={() => swap(index)}>
                    ⇅
                  </ActionIcon>
                </Tooltip>
              </Group>
            ),
          ])}

          <Group gap="xs">
            <Button size="xs" variant="light" onClick={() => setRows([...rows, emptyRow('Baustelle', null, main)])}>
              + Baustelle
            </Button>
            <Tooltip label="Zwei Hälften: 07:30–11:30 und 12:00–16:00; die zweite kann eine Baustelle bekommen oder verfügbar bleiben">
              <Button size="xs" variant="light" onClick={splitDay}>
                ½ Tag
              </Button>
            </Tooltip>
            <Button size="xs" variant="subtle" color="gray" onClick={() => setRows(kept)}>
              Tag leeren
            </Button>
            {onCopy && (
              <Button size="xs" variant="subtle" color="gray" onClick={() => onCopy(toInputs(rows))}>
                Kopieren
              </Button>
            )}
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
