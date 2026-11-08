import { Alert, Button, Group, Select, SimpleGrid, Stack, Table, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useMemo, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { DayEntryInput, Entry, Plan, PlanEmployee, Site } from '../api/types'
import { activityLabel } from '../lib/activities'
import { addDays, formatDate, HALF_DAYS } from '../lib/dates'
import { toInput } from '../lib/ui'
import { handOverUndo, type UndoStep } from '../lib/undoHandoff'
import { Sheet } from './Sheet'

/** The people of the standard flow, by the names the planners call them. */
const PEOPLE = ['Stefan', 'Sascha', 'Niko', 'Neycho', 'Patrick'] as const
type Person = (typeof PEOPLE)[number]

/**
 * The usual course of a bathroom, counted in working days from the Baubeginn (day 1): a help to fill in the plan,
 * changed afterwards where a site differs.
 */
const STANDARD_FLOW: { days: number[]; people: Person[]; activity: string; morning?: boolean }[] = [
  { days: [1], people: ['Stefan'], activity: 'Sanitaer', morning: true },
  { days: [1], people: ['Sascha', 'Niko'], activity: 'Abriss' },
  { days: [2], people: ['Stefan', 'Neycho'], activity: 'Sanitaer' },
  { days: [3, 4, 5], people: ['Sascha', 'Niko'], activity: 'Trockenbau' },
  { days: [6, 7, 8, 9, 10], people: ['Patrick'], activity: 'Fliesen' },
  { days: [11], people: ['Stefan', 'Neycho'], activity: 'Sanitaer' },
]
const FLOW_DAYS = Math.max(...STANDARD_FLOW.flatMap((step) => step.days))

/** The name an employee is called by: before " - " (e.g. "Niko - Nikolay Mihov"), else the first name. */
function callName(name: string): string {
  const plain = name.replace(/\(.*?\)/g, ' ').trim()
  return (plain.includes(' - ') ? plain.split(' - ')[0] : plain.split(/\s+/)[0]).trim().toLowerCase()
}

/** The employee of a person of the flow: the one called so, if there is exactly one. */
function match(person: Person, employees: PlanEmployee[]): number | null {
  const found = employees.filter((employee) => callName(employee.name) === person.toLowerCase())
  return found.length === 1 ? found[0].id : null
}

interface Props {
  site: Site
  onClose: () => void
  /**
   * After the flow was entered, with the change as one step for the undo arrow and the entries saved. Without it
   * the step is handed over to the plan opened next (see handOverUndo).
   */
  onEntered?: (step: UndoStep, saved: Entry[]) => void
}

/**
 * Asked when a Baubeginn is entered: the standard flow into the plan, or the days planned one by one. The flow
 * takes working days only (no weekends, no public holidays) one after the other and replaces the reserved days
 * of the site.
 */
export function StandardFlowDialog({ site, onClose, onEntered }: Props) {
  const start = site.plannedStart!
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [chosen, setChosen] = useState<Partial<Record<Person, number | null>>>({})

  // The year of the Baubeginn, and the next one when the flow may run into it.
  useEffect(() => {
    const year = Number(start.slice(0, 4))
    const years = start.slice(5, 7) >= '11' ? [year, year + 1] : [year]
    Promise.all(years.map((y) => api.plan(y))).then(setPlans, (e) => setError(messageOf(e)))
  }, [start])

  const employees = useMemo(() => {
    const all = new Map<number, PlanEmployee>()
    for (const plan of plans ?? []) for (const employee of plan.employees) all.set(employee.id, employee)
    return [...all.values()]
  }, [plans])
  const entries = useMemo(() => (plans ?? []).flatMap((plan) => plan.entries.filter((e) => e.date.startsWith(`${plan.year}-`))), [plans])
  const publicHolidays = useMemo(
    () =>
      new Set(
        (plans ?? []).flatMap((plan) =>
          plan.schoolHolidays.filter((h) => h.kind === 'Feiertag' && h.startDate === h.endDate).map((h) => h.startDate),
        ),
      ),
    [plans],
  )

  const personId = (person: Person) => (person in chosen ? chosen[person]! : match(person, employees))

  // The working days of the flow: from the Baubeginn on, weekends and public holidays left out.
  const days = useMemo(() => {
    const list: string[] = []
    for (let day = start; list.length < FLOW_DAYS; day = addDays(day, 1)) {
      const weekday = new Date(`${day}T12:00:00`).getDay()
      if (weekday !== 0 && weekday !== 6 && !publicHolidays.has(day)) list.push(day)
    }
    return list
  }, [start, publicHolidays])

  const cell = (employeeId: number, date: string) => entries.filter((e) => e.employeeId === employeeId && e.date === date)
  // Reserved days of this site: the flow takes their place.
  const isOwnReservation = (entry: Entry) => entry.siteId === site.id && !entry.activity

  // What the flow puts into the plan, with what stands in its way.
  const steps = days.map((date, index) => {
    const lines = STANDARD_FLOW.filter((step) => step.days.includes(index + 1)).flatMap((step) =>
      step.people.map((person) => {
        const id = personId(person)
        const others = id === null ? [] : cell(id, date).filter((entry) => !isOwnReservation(entry))
        const absent = others.find((entry) => entry.type !== 'Baustelle')
        // Already there with this activity (e.g. Abriss dragged in when the site was made): not twice.
        const already = others.some((entry) => entry.siteId === site.id && entry.activity === step.activity)
        const busyOn = others.filter((entry) => entry.type === 'Baustelle' && entry.siteId !== site.id)
        // Half a day may not overlap a time window of the day: the morning taken, it goes into the afternoon;
        // both taken, only this line is left out (the rest of the flow is entered all the same).
        const taken = (half: (typeof HALF_DAYS)[number]) =>
          others.filter((entry) => entry.startTime && entry.endTime && entry.startTime < `${half.end}:00` && entry.endTime > `${half.start}:00`)
        const half = !step.morning ? null : taken(HALF_DAYS[0]).length === 0 ? 0 : taken(HALF_DAYS[1]).length === 0 ? 1 : -1
        const names = (list: Entry[]) => list.map((entry) => entry.siteName ?? entry.type).join(', ')
        return {
          person,
          id,
          activity: step.activity,
          half,
          // Time windows of the day in the way: pointed out above the flow.
          overlap: id !== null && !already && absent === undefined && (half === 1 || half === -1),
          warning: id === null
            ? 'nicht zugeordnet: wird ausgelassen'
            : already
              ? 'schon eingetragen'
              : absent
              ? `${absent.type}: wird ausgelassen`
              : half === -1
                ? `ganzer Tag schon in Zeitfenstern belegt (${names(taken(HALF_DAYS[0]))}): wird ausgelassen`
                : half === 1
                  ? `vormittags schon auf ${names(taken(HALF_DAYS[0]))}: kommt nachmittags dazu`
                  : busyOn.length > 0
                    ? `schon auf ${busyOn.map((entry) => entry.siteName).join(', ')}: kommt dazu`
                    : null,
          skip: id === null || absent !== undefined || already || half === -1,
        }
      }),
    )
    return { date, day: index + 1, lines }
  })

  const enter = async () => {
    setBusy(true)
    setError('')
    try {
      const changed = new Map<string, { employeeId: number; date: string; entries: DayEntryInput[] }>()
      const take = (employeeId: number, date: string) => {
        const key = `${employeeId}|${date}`
        if (!changed.has(key))
          changed.set(key, { employeeId, date, entries: cell(employeeId, date).filter((e) => !isOwnReservation(e)).map(toInput) })
        return changed.get(key)!
      }
      // Every reserved day of the site goes, also beyond the flow.
      for (const entry of entries) if (isOwnReservation(entry)) take(entry.employeeId, entry.date)
      for (const step of steps)
        for (const line of step.lines) {
          if (line.skip || line.id === null) continue
          take(line.id, step.date).entries.push({
            type: 'Baustelle',
            siteId: site.id,
            activity: line.activity,
            startTime: line.half === null || line.half < 0 ? null : `${HALF_DAYS[line.half].start}:00`,
            endTime: line.half === null || line.half < 0 ? null : `${HALF_DAYS[line.half].end}:00`,
            note: null,
            noteImportant: false,
          })
        }
      const after = [...changed.values()]
      // The days as they were: the undo arrow takes the whole flow back.
      const before = after.map((change) => ({ ...change, entries: cell(change.employeeId, change.date).map(toInput) }))
      const saved = await api.saveDays(after)
      const step = { label: `${site.name}: Standardablauf`, before, after }
      if (onEntered) onEntered(step, saved)
      else handOverUndo(step)
      notifications.show({ color: 'green', message: `${site.name}: Standardablauf eingetragen. Der Pfeil „Rückgängig“ in der Planung nimmt ihn zurück.` })
      onClose()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  // "Fr 06.03.": the weekday and the day without the year.
  const short = (iso: string) => formatDate(iso).slice(0, 9)
  const nameOf = (id: number | null) => employees.find((employee) => employee.id === id)?.name
  const overlaps = steps.flatMap((step) =>
    step.lines.filter((line) => line.overlap).map((line) => `${short(step.date)}: ${nameOf(line.id) ?? line.person} ${line.warning}`),
  )

  return (
    <Sheet onClose={onClose} title={<Text fw={700}>Baubeginn {formatDate(start)}: {site.name}</Text>} size="lg">
      <Stack gap="sm">
        <Text size="sm">
          Soll der <strong>Standardablauf</strong> eingetragen werden, oder werden die Termine <strong>individuell</strong> geplant? Der
          Standardablauf ist eine Vorlage: Er lässt sich danach im Kalender wie jeder andere Eintrag ändern.
        </Text>
        {/* The answer right under the question, not below the long list of days. */}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Individuell planen
          </Button>
          <Button loading={busy} disabled={!plans} onClick={enter}>
            Standardablauf eintragen
          </Button>
        </Group>
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        {overlaps.length > 0 && (
          <Alert color="orange" variant="light" title="Überschneidungen" role="alert" aria-label="Überschneidungen">
            <Stack gap={2}>
              {overlaps.map((text) => (
                <Text key={text} size="sm">
                  {text}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}
        {plans && (
          <>
            <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="xs">
              {PEOPLE.map((person) => (
                <Select
                  key={person}
                  label={person}
                  size="xs"
                  placeholder="niemand"
                  value={personId(person) === null ? null : String(personId(person))}
                  onChange={(value) => setChosen((current) => ({ ...current, [person]: value ? Number(value) : null }))}
                  data={employees.map((employee) => ({ value: String(employee.id), label: employee.name }))}
                  clearable
                  searchable
                />
              ))}
            </SimpleGrid>
            <Table withTableBorder striped verticalSpacing={4} fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={110}>Tag</Table.Th>
                  <Table.Th>Wer · Tätigkeit</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {steps.map((step) => (
                  <Table.Tr key={step.date}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {step.day}. Tag
                      </Text>
                      <Text size="xs" c="dimmed">
                        {short(step.date)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {step.lines.map((line) => (
                        <Text key={line.person} size="sm" c={line.skip ? 'dimmed' : undefined} td={line.skip ? 'line-through' : undefined}>
                          {nameOf(line.id) ?? line.person} · {activityLabel(line.activity)}
                          {line.half === 0 ? ' · ½ Tag vormittags' : line.half === 1 ? ' · ½ Tag nachmittags' : ''}
                          {line.warning && (
                            <Text span size="xs" c="orange.8" td="none">
                              {' '}
                              ({line.warning})
                            </Text>
                          )}
                        </Text>
                      ))}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Text size="xs" c="dimmed">
              Nur Werktage, aufeinanderfolgend; Wochenenden und Feiertage werden übersprungen. Reservierte Tage der Baustelle werden
              durch den Ablauf ersetzt.
            </Text>
          </>
        )}
      </Stack>
    </Sheet>
  )
}
