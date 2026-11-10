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
import { activityLabel, allowedActivities, defaultActivity, entryStyle, isFree, isOpen, onlyHalfDay } from '../lib/activities'
import { formatDateLong, HALF_DAYS, WHOLE_DAY } from '../lib/dates'
import { emptySite } from '../lib/sites'
import { Sheet } from './Sheet'
import { SitePicker } from './SitePicker'
import { ServiceForm, serviceTimes, type ServiceTime } from './ServiceForm'
import { TimeSelect } from './TimeSelect'

interface Props {
  employee: PlanEmployee
  date: string
  entries: Entry[]
  sites: Site[]
  onCreateSite: (input: SiteInput) => Promise<Site>
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
  /** The free half of a day clicked: added as a new row with these times, its site chosen here. */
  addHalf?: { start: string; end: string }
  /** "verfügbar" clicked: the rows kept free get a site to choose, in the same time. */
  fillFree?: boolean
  /** The plan the day is edited in: in the Bauphase an offer site is reserved (no activity) until its Baubeginn. */
  phase?: 'Angebot' | 'Bauphase'
  /** The customer confirmed an appointment of the day: it becomes a service call or a site. */
  onConfirm?: (site: Site, asService: boolean) => Promise<void>
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

/**
 * Half a day on sites and nothing kept free for the rest: the other half, to be saved as "verfügbar". Rows
 * without a site yet do not count as work (they would be free anyway). Null when the day is something else:
 * a whole day, both halves taken, a free row already there, or Urlaub or Krank.
 */
export function otherHalfFree(rows: Pick<Row, 'type' | 'siteId' | 'activity' | 'free' | 'start' | 'end'>[]) {
  if (rows.some((row) => row.type !== 'Baustelle' || row.free)) return null
  const work = rows.filter((row) => row.siteId !== null)
  // Each with its time window and together no more than half a day (the site name only marks it as no free row).
  const half = onlyHalfDay(
    work.map((row) => ({ type: row.type, activity: row.activity, siteName: 'Baustelle', startTime: row.start || null, endTime: row.end || null })),
  )
  if (!half) return null
  if (work.every((row) => row.end <= '12:00')) return HALF_DAYS[1]
  if (work.every((row) => row.start >= '12:00')) return HALF_DAYS[0]
  return null
}

/**
 * A second entry of the day (a site, service call or appointment): it goes into the afternoon, and the one
 * entry there was (the whole day, or without times) into the morning. Times chosen by hand stay.
 */
function withSecond(current: Row[], added: Row): Row[] {
  const work = current.filter((row) => row.type === 'Baustelle' && row.siteId !== null && !row.free)
  if (work.length !== 1) return [...current, added]
  const [first] = work
  const wholeDay = !first.start || !first.end || (first.start <= HALF_DAYS[0].start && first.end >= HALF_DAYS[1].end)
  // The morning chosen for the new one: both stay as they are.
  if (added.start && added.start < '12:00') return [...current, added]
  const second = added.start ? added : { ...added, ...HALF_DAYS[1] }
  return [...current.map((row) => (row === first && wholeDay ? { ...row, ...HALF_DAYS[0] } : row)), second]
}

/** Edits all entries of one employee on one day. Several rows with time windows make a split day. */
export function DayEditor(props: Props) {
  const { employee, date, entries, sites, onCreateSite, onGoToSite, canAbsence = false, onClose, onSave, onCopy } = props
  // A new site row starts without an activity: it follows the site chosen.
  const main = null
  // The activities offered follow the status of an open site. On a done or cancelled site (entries from
  // before it was closed) the employee's own activities are offered, whatever the status was then.
  const statusOf = (siteId: number | null) => {
    const site = sites.find((candidate) => candidate.id === siteId)
    const status = site?.status
    // In the Bauphase an offer site with its Baubeginn is planned as a construction.
    if (props.phase === 'Bauphase' && status === 'Angebot' && site?.plannedStart) return 'Bauphase'
    return status && isOpen(status) ? status : undefined
  }
  // In the Bauphase an offer site without Baubeginn gets reserved days: no activity yet.
  const reserves = (siteId: number | null) => {
    const site = sites.find((candidate) => candidate.id === siteId)
    return props.phase === 'Bauphase' && site?.status === 'Angebot' && !site.plannedStart
  }
  const siteName = (siteId: number | null) => sites.find((site) => site.id === siteId)?.name
  const tentativeSite = (siteId: number | null) => sites.find((site) => site.id === siteId && site.isTentative)
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
      free: !props.fillFree && isFree(e),
      start: e.startTime?.slice(0, 5) ?? '',
      end: e.endTime?.slice(0, 5) ?? '',
      note: e.note ?? '',
      important: e.noteImportant,
    }))
    if (props.addActivity) return [...saved, emptyRow('Baustelle', null, props.addActivity)]
    if (props.addHalf) return [...saved, { ...emptyRow('Baustelle', null, main), ...props.addHalf }]
    return saved.length === 0 ? [emptyRow('Baustelle', null, main)] : saved
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Saving half a day: the other half asked to be set "verfügbar" first (see otherHalfFree).
  const [freeHalf, setFreeHalf] = useState<{ start: string; end: string } | null>(null)
  // Any change of the rows asks again.
  useEffect(() => setFreeHalf(null), [rows])

  // A site created here goes onto the day at once, with the activity of its row (e.g. the one dragged in):
  // saved as soon as the new site is in its row.
  const createdSite = useRef<number | null>(null)
  const createSite = async (input: SiteInput) => {
    const site = await onCreateSite(input)
    createdSite.current = site.id
    return site
  }

  // A service call (or an appointment not confirmed yet, without an activity): created on the spot and put on the
  // day in place of rows still without a site; saved then.
  const [addingService, setAddingService] = useState<'service' | 'tentative' | null>(null)
  const createService = async (input: SiteInput, time: ServiceTime) => {
    const site = await createSite(input)
    setRows((current) =>
      withSecond(
        current.filter((row) => !(row.type === 'Baustelle' && row.siteId === null && !row.free)),
        { ...emptyRow('Baustelle', site.id, input.isTentative ? null : defaultActivity(employee, 'Bauphase')), ...serviceTimes(time) },
      ),
    )
    return site
  }
  // Already one site on the day: what comes next is the afternoon.
  const hasWork = rows.some((row) => row.type === 'Baustelle' && row.siteId !== null && !row.free)
  const [confirming, setConfirming] = useState(false)
  const confirm = async (site: Site, asService: boolean) => {
    setConfirming(true)
    setError('')
    try {
      await props.onConfirm!(site, asService)
    } catch (e) {
      setError(messageOf(e))
      setConfirming(false)
    }
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

  const save = async (confirmed = false) => {
    const other = otherHalfFree(rows)
    if (other && !confirmed) {
      setFreeHalf(other)
      return
    }
    // The other half of the day becomes a row kept free, in place of rows still without a site.
    const saved = other
      ? [...rows.filter((row) => row.siteId !== null), { ...emptyRow('Baustelle'), free: true, ...other }].sort((a, b) =>
          a.start.localeCompare(b.start),
        )
      : rows
    setFreeHalf(null)
    setBusy(true)
    setError('')
    try {
      await onSave(toInputs(saved))
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
          {/* First the question what comes onto the day: a site or a service call. */}
          <Group gap="sm" justify="space-between" wrap="wrap" className="day-add">
            <Text fw={600} size="sm" c="wego.9">
              Was soll eingetragen werden?
            </Text>
            <Group gap="xs">
              <Button size="sm" onClick={() => setRows((current) => withSecond(current, emptyRow('Baustelle', null, main)))}>
                + Baustelle
              </Button>
              <Tooltip label="Arbeiten an einem Termin, ohne eigene Baustelle: nur Kunde, Adresse, Telefon und was zu tun ist">
                <Button size="sm" color="wegoRed.6" onClick={() => setAddingService('service')}>
                  + Serviceauftrag
                </Button>
              </Tooltip>
              <Tooltip label="Für einen Kunden reservieren, der den Termin noch nicht bestätigt hat: im Kalender ohne Farbe">
                <Button size="sm" variant="outline" onClick={() => setAddingService('tentative')}>
                  + Termin (unbestätigt)
                </Button>
              </Tooltip>
            </Group>
          </Group>
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
                {/* An appointment not confirmed yet: once the customer says yes, it becomes a service call or a site. */}
                {row.type === 'Baustelle' && tentativeSite(row.siteId) && props.onConfirm && (
                  <Alert color="gray" variant="outline" p="xs" title="Unbestätigter Termin">
                    <Text size="xs" mb={6}>
                      Hat der Kunde bestätigt?
                    </Text>
                    <Group gap="xs">
                      <Button size="xs" color="wegoRed.6" loading={confirming} onClick={() => void confirm(tentativeSite(row.siteId)!, true)}>
                        Bestätigen als Serviceauftrag
                      </Button>
                      <Button size="xs" loading={confirming} onClick={() => void confirm(tentativeSite(row.siteId)!, false)}>
                        Bestätigen als Baustelle
                      </Button>
                    </Group>
                  </Alert>
                )}
                {row.type === 'Baustelle' && !row.free && reserves(row.siteId) && !tentativeSite(row.siteId) && (
                  <Text size="xs" c="dimmed">
                    Reserviert: die Baustelle ist noch im Angebot. Tätigkeiten gibt es, sobald der Baubeginn eingetragen ist.
                  </Text>
                )}
                {row.type === 'Baustelle' && !row.free && (
                  <SitePicker
                    sites={sites}
                    value={row.siteId}
                    onChange={(siteId) => {
                      // Another site may be in another status: keep the activity only if it fits there.
                      const status = statusOf(siteId)
                      const fits = row.activity !== null && allowedActivities(employee, status).includes(row.activity)
                      update(index, { siteId, activity: reserves(siteId) ? null : fits ? row.activity : defaultActivity(employee, status) })
                    }}
                    onCreate={createSite}
                    onGoToSite={onGoToSite}
                    // A new site for the start of the construction (Abriss / Baubeginn) begins on this day.
                    // Created in the plan of the Bauphase, it begins as Bauphase.
                    newSite={{
                      ...emptySite,
                      ...(props.phase === 'Bauphase' ? { status: 'Bauphase' as const } : {}),
                      ...(row.activity === 'Abriss' ? { plannedStart: date } : {}),
                    }}
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

          {addingService && (
            <ServiceForm
              date={date}
              tentative={addingService === 'tentative'}
              initialTime={hasWork ? 'afternoon' : 'day'}
              onCreate={createService}
              onClose={() => setAddingService(null)}
            />
          )}

          {freeHalf ? (
            <Alert color="wego" variant="light" title="Nur ½ Tag eingetragen">
              <Text size="sm">
                Die andere Hälfte des Tages ({freeHalf.start}–{freeHalf.end}) wird auf „verfügbar“ gesetzt.
              </Text>
              <Group justify="flex-end" mt="sm">
                <Button variant="default" onClick={() => setFreeHalf(null)}>
                  Zurück
                </Button>
                <Button loading={busy} onClick={() => void save(true)} data-autofocus>
                  OK, speichern
                </Button>
              </Group>
            </Alert>
          ) : (
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Abbrechen
              </Button>
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </Group>
          )}
        </Stack>
      </form>
    </Sheet>
  )
}
