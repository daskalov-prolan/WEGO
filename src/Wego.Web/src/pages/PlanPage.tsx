import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Menu,
  Paper,
  SegmentedControl,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useWindowEvent } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Customer, DayEntryInput, Entry, NamedItem, Plan } from '../api/types'
import { AssignSite } from '../components/AssignSite'
import { DayDetails } from '../components/DayDetails'
import { DayEditor } from '../components/DayEditor'
import { DayMatrix } from '../components/PlanMatrix'
import {
  addDays,
  addMonths,
  daysBetween,
  daysOfYear,
  isoWeek,
  MONTHS,
  monthOf,
  todayIso,
  weekOf,
} from '../lib/dates'
import { cellKey, toInput } from '../lib/ui'
import { useIsPhone } from '../lib/useIsPhone'

interface Props {
  year: number
  canEdit: boolean
}

type View = 'week' | 'month' | 'year'
type DayChange = { employeeId: number; date: string; entries: DayEntryInput[] }

const HIDDEN_KEY = 'wego.plan.hiddenEmployees'

function loadHidden(): number[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((id) => typeof id === 'number') : []
  } catch {
    return []
  }
}

const parseKey = (key: string) => {
  const [employeeId, date] = key.split('|')
  return { employeeId: Number(employeeId), date }
}

/**
 * The plan of everybody. The week is the working unit: employees in rows, weekdays in columns, which
 * fits from phone to desktop. Month and year are overviews; the year grid (as in the Excel sheet)
 * is offered on wide screens only. Planners select cells to fill many days at once.
 */
export function PlanPage({ year, canEdit }: Props) {
  const first = `${year}-01-01`
  const last = `${year}-12-31`
  const today = todayIso()
  const isPhone = useIsPhone()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [chosenView, setChosenView] = useState<View>('week')
  const [anchor, setAnchor] = useState(today >= first && today <= last ? today : first)
  const [filter, setFilter] = useState('')
  const [hidden, setHidden] = useState<number[]>(loadHidden)
  const [open, setOpen] = useState<{ employee: NamedItem; date: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)
  const [clipboard, setClipboard] = useState<{ label: string; entries: DayEntryInput[] } | null>(null)

  useEffect(() => {
    api.plan(year).then(setPlan, (e) => setError(messageOf(e)))
  }, [year])

  useWindowEvent('keydown', (event) => {
    if (event.key === 'Escape' && selected.size > 0) setSelected(new Set())
  })

  const entriesByCell = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const entry of plan?.entries ?? []) {
      const key = cellKey(entry.employeeId, entry.date)
      const list = map.get(key)
      if (list) list.push(entry)
      else map.set(key, [entry])
    }
    return map
  }, [plan])

  const holidayByDate = useMemo(() => {
    const map = new Map<string, string>()
    for (const holiday of plan?.schoolHolidays ?? []) {
      for (const day of daysBetween(holiday.startDate, holiday.endDate)) map.set(day.iso, holiday.name)
    }
    return map
  }, [plan])

  const siteById = useMemo(() => new Map((plan?.customers ?? []).map((site) => [site.id, site])), [plan])
  const customerNames = useMemo(() => (plan?.customers ?? []).map((site) => site.name), [plan])
  const yearDays = useMemo(() => daysOfYear(year), [year])

  // The sites of the shown week and the weeks around it, most used first: one tap instead of typing.
  const recentSites = useMemo(() => {
    const from = addDays(weekOf(anchor)[0].iso, -7)
    const to = addDays(from, 20)
    const counts = new Map<number, number>()
    for (const entry of plan?.entries ?? []) {
      if (entry.customerId === null || entry.date < from || entry.date > to) continue
      counts.set(entry.customerId, (counts.get(entry.customerId) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => siteById.get(id))
      .filter((site): site is Customer => site !== undefined)
  }, [plan, anchor, siteById])

  const needle = filter.trim().toLowerCase()
  const matches = useCallback(
    (entry: Entry) => needle !== '' && (entry.customerName ?? '').toLowerCase().includes(needle),
    [needle],
  )
  const matchingDates = useMemo(() => {
    if (needle === '' || !plan) return null
    return new Set(plan.entries.filter(matches).map((entry) => entry.date))
  }, [plan, needle, matches])

  const view = chosenView
  const inYear = (iso: string) => iso >= first && iso <= last
  const go = (iso: string) => setAnchor(iso < first ? first : iso > last ? last : iso)
  const step = (direction: 1 | -1) =>
    go(view === 'month' ? addMonths(anchor, direction) : addDays(anchor, 7 * direction))

  if (error) return <p className="error page">{error}</p>
  if (!plan || plan.year !== year) return null

  const entriesOf = (employeeId: number, date: string) => entriesByCell.get(cellKey(employeeId, date)) ?? []
  const isDimmed = (entry: Entry) => needle !== '' && !matches(entry)
  const employees = plan.employees.filter((employee) => !hidden.includes(employee.id))

  const toggleEmployee = (id: number) => {
    const next = hidden.includes(id) ? hidden.filter((other) => other !== id) : [...hidden, id]
    setHidden(next)
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next))
    } catch {
      // Without storage the selection simply lasts until the page is reloaded.
    }
  }

  /** Puts what the server stored into the plan, without loading the whole year again. */
  const merge = (changes: DayChange[], saved: Entry[]) => {
    const keys = new Set(changes.map((change) => cellKey(change.employeeId, change.date)))
    setPlan((current) => {
      if (!current) return current
      const known = new Set(current.customers.map((site) => site.id))
      const added = saved
        .filter((entry) => entry.customerId !== null && !known.has(entry.customerId))
        .map((entry) => ({ id: entry.customerId!, name: entry.customerName!, location: null, description: null }))
      return {
        ...current,
        entries: [...current.entries.filter((e) => !keys.has(cellKey(e.employeeId, e.date))), ...saved],
        customers: added.length
          ? [...current.customers, ...new Map(added.map((site) => [site.id, site])).values()].sort((a, b) =>
              a.name.localeCompare(b.name, 'de'),
            )
          : current.customers,
      }
    })
  }

  /** Saves days and offers to take the change back. Rejects with the server's message. */
  const save = async (changes: DayChange[], message: string) => {
    const previous = changes.map((change) => ({
      ...change,
      entries: entriesOf(change.employeeId, change.date).map(toInput),
    }))
    merge(changes, await api.saveDays(changes))

    const id = `saved-${Date.now()}`
    notifications.show({
      id,
      autoClose: 7000,
      message: (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm">{message}</Text>
          <Button
            size="compact-sm"
            variant="light"
            onClick={async () => {
              notifications.hide(id)
              try {
                merge(previous, await api.saveDays(previous))
                notifications.show({ message: 'Rückgängig gemacht.', autoClose: 3000 })
              } catch (e) {
                notifications.show({ color: 'red', message: messageOf(e) })
              }
            }}
          >
            Rückgängig
          </Button>
        </Group>
      ),
    })
  }

  const applyToSelection = async (build: (employeeId: number, date: string) => DayEntryInput[], message: string) => {
    const changes = [...selected].map(parseKey).map(({ employeeId, date }) => ({
      employeeId,
      date,
      entries: build(employeeId, date),
    }))
    try {
      await save(changes, message)
      setSelected(new Set())
    } catch (e) {
      notifications.show({ color: 'red', message: messageOf(e) })
    }
  }

  const copyWeekForward = async () => {
    const changes: DayChange[] = []
    for (const day of weekOf(anchor)) {
      const target = addDays(day.iso, 7)
      if (!inYear(day.iso) || !inYear(target)) continue
      for (const employee of employees) {
        const entries = entriesOf(employee.id, day.iso).filter((entry) => entry.type === 'Baustelle')
        // Only empty days of the next week are filled, nothing planned there is overwritten.
        if (entries.length > 0 && entriesOf(employee.id, target).length === 0) {
          changes.push({ employeeId: employee.id, date: target, entries: entries.map(toInput) })
        }
      }
    }
    if (changes.length === 0) {
      notifications.show({ message: 'Nichts zu übernehmen: die nächste Woche ist schon belegt oder diese leer.' })
      return
    }
    try {
      await save(changes, `${changes.length} Tage in die nächste Woche übernommen.`)
      go(addDays(anchor, 7))
    } catch (e) {
      notifications.show({ color: 'red', message: messageOf(e) })
    }
  }

  const week = weekOf(anchor).filter((day) => inYear(day.iso))
  const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
  const title =
    view === 'week'
      ? `KW ${isoWeek(anchor)} · ${short(week[0].iso)}–${short(week[week.length - 1].iso)}${year}`
      : view === 'month'
        ? `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${year}`
        : `${year}`

  const filteredCustomer = plan.customers.find((customer) => customer.name.toLowerCase() === needle)
  const shared = {
    employees,
    entriesOf,
    holidayByDate,
    today,
    isDimmed,
    linkNames: canEdit,
    onOpen: (employee: NamedItem, date: string) => setOpen({ employee, date }),
    selectable: canEdit,
    selected,
    onSelectedChange: setSelected,
  }
  const singleSelected = selected.size === 1 ? parseKey([...selected][0]) : null
  const singleEntries = singleSelected ? entriesOf(singleSelected.employeeId, singleSelected.date) : []

  return (
    <div className="plan">
      <div className="plan-toolbar">
        <Group gap="xs" wrap="wrap">
          <SegmentedControl
            value={view}
            onChange={(value) => setChosenView(value as View)}
            data={[
              { value: 'week', label: 'Woche' },
              { value: 'month', label: 'Monat' },
              { value: 'year', label: 'Jahr' },
            ]}
          />
          {view !== 'year' && (
            <Group gap={4}>
              <ActionIcon variant="default" size="lg" onClick={() => step(-1)} aria-label="Zurück">
                ‹
              </ActionIcon>
              <ActionIcon variant="default" size="lg" onClick={() => step(1)} aria-label="Weiter">
                ›
              </ActionIcon>
            </Group>
          )}
          {inYear(today) && (
            <Button
              variant="default"
              onClick={() => {
                setAnchor(today)
                if (view === 'year') document.getElementById(`d-${today}`)?.scrollIntoView({ block: 'start' })
              }}
            >
              Heute
            </Button>
          )}
          <Text fw={700} c="wego.9" className="plan-title">
            {title}
          </Text>
        </Group>

        <Group gap="xs" wrap="wrap">
          <TextInput
            className="plan-filter"
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
            placeholder="Baustelle hervorheben"
            type="search"
            aria-label="Nach Baustelle (Kunde) filtern"
          />
          {view !== 'year' && (
            <DatePickerInput
              value={anchor}
              onChange={(value) => value && go(value)}
              minDate={first}
              maxDate={last}
              valueFormat="DD.MM.YYYY"
              aria-label="Datum"
              w={130}
            />
          )}

          <Menu closeOnItemClick={false} position="bottom-start" withinPortal>
            <Menu.Target>
              <Button variant="default">
                Mitarbeiter ({employees.length}/{plan.employees.length})
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {plan.employees.map((employee) => (
                <Menu.Item key={employee.id} onClick={() => toggleEmployee(employee.id)}>
                  <Checkbox
                    label={employee.name}
                    checked={!hidden.includes(employee.id)}
                    onChange={() => toggleEmployee(employee.id)}
                    onClick={(event) => event.stopPropagation()}
                  />
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>

          {canEdit && view === 'week' && (
            <Tooltip label="Baustellen dieser Woche auf freie Tage der nächsten Woche übertragen">
              <Button variant="light" onClick={copyWeekForward}>
                Woche fortsetzen
              </Button>
            </Tooltip>
          )}

          {matchingDates && (
            <Text size="sm" c="dimmed">
              {matchingDates.size} {matchingDates.size === 1 ? 'Tag' : 'Tage'} mit Einsätzen in {year}
              {filteredCustomer && canEdit && (
                <>
                  {' · '}
                  <a href={`#/baustellen/${filteredCustomer.id}`}>Auswertung öffnen</a>
                </>
              )}
            </Text>
          )}
        </Group>
        {canEdit && selected.size === 0 && !isPhone && (
          <Text size="xs" c="dimmed">
            Tipp: Mit gedrückter Maustaste über mehrere Felder ziehen oder mit Strg+Klick auswählen, um viele Tage
            auf einmal zu belegen.
          </Text>
        )}
        {canEdit && isPhone && selected.size === 0 && (
          <Text size="xs" c="dimmed">
            Tipp: Feld lange drücken, um mehrere Tage auszuwählen.
          </Text>
        )}
      </div>

      <div className="plan-scroll">
        {plan.employees.length === 0 ? (
          <p className="page">
            Noch keine Mitarbeiter angelegt.
            {canEdit && (
              <>
                {' '}
                <a href="#/verwaltung">Zur Verwaltung</a>
              </>
            )}
          </p>
        ) : view === 'week' ? (
          <DayMatrix days={week} foldEmptyWeekends {...shared} />
        ) : view === 'month' ? (
          <DayMatrix days={monthOf(anchor)} {...shared} />
        ) : (
          // In the whole year a filter is only useful if it removes the days without a match.
          <DayMatrix
            days={matchingDates ? yearDays.filter((day) => matchingDates.has(day.iso)) : yearDays}
            monthHeadings
            {...shared}
          />
        )}
      </div>

      {selected.size > 0 && (
        <Paper className="selection-bar" shadow="lg" p="sm" withBorder>
          <Group gap="xs" justify="space-between" wrap="wrap">
            <Text fw={700} size="sm">
              {selected.size} {selected.size === 1 ? 'Feld' : 'Felder'} ausgewählt
            </Text>
            <Group gap={6} wrap="wrap">
              <Button size="xs" onClick={() => setAssigning(true)}>
                Baustelle …
              </Button>
              <Button
                size="xs"
                color="green"
                variant="light"
                onClick={() =>
                  applyToSelection(
                    () => [{ type: 'Urlaub', customerName: null, startTime: null, endTime: null, note: null }],
                    `${selected.size} Tage als Urlaub eingetragen.`,
                  )
                }
              >
                Urlaub
              </Button>
              <Button
                size="xs"
                color="red"
                variant="light"
                onClick={() =>
                  applyToSelection(
                    () => [{ type: 'Krank', customerName: null, startTime: null, endTime: null, note: null }],
                    `${selected.size} Tage als krank eingetragen.`,
                  )
                }
              >
                Krank
              </Button>
              {singleEntries.length > 0 && (
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => {
                    setClipboard({
                      label: singleEntries.map((e) => e.customerName ?? e.type).join(' / '),
                      entries: singleEntries.map(toInput),
                    })
                    notifications.show({ message: 'Kopiert. Felder auswählen und „Einfügen“ wählen.', autoClose: 3000 })
                  }}
                >
                  Kopieren
                </Button>
              )}
              {clipboard && (
                <Tooltip label={clipboard.label}>
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() =>
                      applyToSelection(() => clipboard.entries, `In ${selected.size} Felder eingefügt.`)
                    }
                  >
                    Einfügen
                  </Button>
                </Tooltip>
              )}
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => applyToSelection(() => [], `${selected.size} Felder geleert.`)}
              >
                Leeren
              </Button>
              <Button size="xs" variant="subtle" color="gray" onClick={() => setSelected(new Set())}>
                Abbrechen
              </Button>
            </Group>
          </Group>
        </Paper>
      )}

      {assigning && (
        <AssignSite
          cellCount={selected.size}
          customerNames={customerNames}
          recentSites={recentSites}
          onClose={() => setAssigning(false)}
          onApply={async (entry, add) => {
            const changes = [...selected].map(parseKey).map(({ employeeId, date }) => ({
              employeeId,
              date,
              entries: add ? [...entriesOf(employeeId, date).map(toInput), entry] : [entry],
            }))
            await save(changes, `${entry.customerName} in ${changes.length} Felder eingetragen.`)
            setAssigning(false)
            setSelected(new Set())
          }}
        />
      )}

      {open &&
        (canEdit ? (
          <DayEditor
            key={cellKey(open.employee.id, open.date)}
            employee={open.employee}
            date={open.date}
            entries={entriesOf(open.employee.id, open.date)}
            customerNames={customerNames}
            recentSites={recentSites}
            onClose={() => setOpen(null)}
            onSave={async (entries) => {
              await save(
                [{ employeeId: open.employee.id, date: open.date, entries }],
                `${open.employee.name}: Tag gespeichert.`,
              )
              setOpen(null)
            }}
            onCopy={(entries) => {
              setClipboard({
                label: entries.map((e) => e.customerName || e.type).join(' / ') || 'leerer Tag',
                entries,
              })
              setOpen(null)
              notifications.show({ message: 'Kopiert. Felder auswählen und „Einfügen“ wählen.', autoClose: 3000 })
            }}
          />
        ) : (
          <DayDetails
            key={cellKey(open.employee.id, open.date)}
            employee={open.employee}
            date={open.date}
            entries={entriesOf(open.employee.id, open.date)}
            holiday={holidayByDate.get(open.date)}
            siteById={siteById}
            onClose={() => setOpen(null)}
          />
        ))}
    </div>
  )
}
