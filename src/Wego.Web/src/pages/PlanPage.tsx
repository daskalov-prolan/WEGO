import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Menu,
  Paper,
  SegmentedControl,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useWindowEvent } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { DayEntryInput, Entry, Plan, PlanEmployee, Site, SiteInput } from '../api/types'
import { SiteForm } from '../components/SiteForm'
import { SiteSheet } from '../components/SiteSheet'
import { toSiteInput } from '../lib/sites'
import { ActivityLegend } from '../components/ActivityPicker'
import { AssignSite } from '../components/AssignSite'
import { allowedActivities } from '../lib/activities'
import { DayDetails } from '../components/DayDetails'
import { DayEditor } from '../components/DayEditor'
import { TimelineMatrix } from '../components/PlanMatrix'
import {
  addDays,
  addMonths,
  daysOfYear,
  isoWeek,
  MONTHS,
  todayIso,
  weekOf,
} from '../lib/dates'
import { cellKey, holidaysByDate, toInput } from '../lib/ui'
import { useIsPhone } from '../lib/useIsPhone'

interface Props {
  year: number
  canEdit: boolean
}

type View = 'week' | 'month' | 'year'
type DayChange = { employeeId: number; date: string; entries: DayEntryInput[] }

const HIDDEN_KEY = 'wego.plan.hiddenEmployees'
const WEEKENDS_KEY = 'wego.plan.showWeekends'

function loadFoldWeekends(): boolean {
  try {
    return localStorage.getItem(WEEKENDS_KEY) !== 'true'
  } catch {
    return true
  }
}

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
 * The plan of everybody as a timeline: one row per employee, the days of the year from left to right,
 * scrolled freely while the employees stay in view. Woche, Monat and Jahr are zoom levels.
 * Planners select cells to fill many days at once.
 */
export function PlanPage({ year, canEdit }: Props) {
  const first = `${year}-01-01`
  const last = `${year}-12-31`
  const today = todayIso()
  const isPhone = useIsPhone()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [chosenView, setChosenView] = useState<View>('week')
  // The days that are currently in view; follows the scrolling.
  const start = weekOf(today >= first && today <= last ? today : first)[0].iso
  const [visible, setVisible] = useState({ from: start < first ? first : start, to: addDays(start, 13) })
  const anchor = visible.from
  const scroller = useRef<HTMLDivElement>(null)
  const notificationCount = useRef(0)
  // A scroll that has to wait until the table is drawn (first load, other zoom, weekends shown or folded).
  const pendingScroll = useRef<{ iso: string; smooth: boolean } | null>({ iso: anchor, smooth: false })
  const [foldWeekends, setFoldWeekends] = useState(loadFoldWeekends)
  const [filter, setFilter] = useState('')
  const [hidden, setHidden] = useState<number[]>(loadHidden)
  const [open, setOpen] = useState<{ employee: PlanEmployee; date: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)
  // A site opened from a cell, and whether its form is open.
  const [shownSite, setShownSite] = useState<{ site: Site; editing: boolean } | null>(null)
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

  const holidayByDate = useMemo(() => holidaysByDate(plan?.schoolHolidays ?? []), [plan])


  const siteById = useMemo(() => new Map((plan?.sites ?? []).map((site) => [site.id, site])), [plan])
  const yearDays = useMemo(() => daysOfYear(year), [year])

  // The sites of the shown week and the weeks around it, most used first: one tap instead of typing.
  const recentSites = useMemo(() => {
    const from = addDays(weekOf(anchor)[0].iso, -7)
    const to = addDays(from, 20)
    const counts = new Map<number, number>()
    for (const entry of plan?.entries ?? []) {
      if (entry.siteId === null || entry.date < from || entry.date > to) continue
      counts.set(entry.siteId, (counts.get(entry.siteId) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => siteById.get(id))
      .filter((site): site is Site => site !== undefined)
  }, [plan, anchor, siteById])

  const needle = filter.trim().toLowerCase()
  const matches = useCallback(
    (entry: Entry) => needle !== '' && (entry.siteName ?? '').toLowerCase().includes(needle),
    [needle],
  )
  const matchingDates = useMemo(() => {
    if (needle === '' || !plan) return null
    return new Set(plan.entries.filter(matches).map((entry) => entry.date))
  }, [plan, needle, matches])

  const view = chosenView
  const inYear = (iso: string) => iso >= first && iso <= last
  const clamp = (iso: string) => (iso < first ? first : iso > last ? last : iso)

  const nameWidth = () => scroller.current?.querySelector<HTMLElement>('th.corner')?.offsetWidth ?? 0

  /** The days between the employee names and the right edge, read from the drawn columns. */
  const readVisible = () => {
    const element = scroller.current
    if (!element) return null
    const left = element.scrollLeft + nameWidth()
    const right = element.scrollLeft + element.clientWidth
    let from: string | null = null
    let to: string | null = null
    for (const column of element.querySelectorAll<HTMLElement>('th.dayhead')) {
      if (column.offsetWidth === 0) return null
      const iso = column.id.slice(4)
      if (!from && column.offsetLeft + column.offsetWidth > left + 1) from = iso
      if (column.offsetLeft < right) to = iso
    }
    return from && to ? { from, to } : null
  }

  const scrollNow = (iso: string, smooth: boolean) => {
    const column = document.getElementById(`col-${iso}`)
    if (!scroller.current || !column) return false
    scroller.current.scrollTo?.({ left: column.offsetLeft - nameWidth(), behavior: smooth ? 'smooth' : 'auto' })
    return true
  }

  /** Scrolls so that the given day is the first one next to the employee names. */
  const scrollToDate = (iso: string, smooth = false) => {
    const from = clamp(iso)
    setVisible({ from, to: clamp(addDays(from, view === 'week' ? 13 : 30)) })
    if (!scrollNow(from, smooth)) pendingScroll.current = { iso: from, smooth }
  }

  const onScroll = () => {
    const next = readVisible()
    if (next && (next.from !== visible.from || next.to !== visible.to)) setVisible(next)
  }

  // Runs after every drawing of the table: carries out a scroll that had to wait for it.
  useLayoutEffect(() => {
    const pending = pendingScroll.current
    if (pending && scrollNow(pending.iso, pending.smooth)) pendingScroll.current = null
  })

  const changeZoom = (next: View) => {
    pendingScroll.current = { iso: anchor, smooth: false }
    setChosenView(next)
  }

  const toggleWeekends = (fold: boolean) => {
    pendingScroll.current = { iso: anchor, smooth: false }
    setFoldWeekends(fold)
    try {
      localStorage.setItem(WEEKENDS_KEY, String(!fold))
    } catch {
      // Without storage the choice lasts until the page is reloaded.
    }
  }

  const step = (direction: 1 | -1) =>
    scrollToDate(view === 'week' ? addDays(weekOf(anchor)[0].iso, 7 * direction) : addMonths(anchor, direction), true)
  if (error) return <p className="error page">{error}</p>
  if (!plan || plan.year !== year) return null

  const entriesOf = (employeeId: number, date: string) => entriesByCell.get(cellKey(employeeId, date)) ?? []
  const isDimmed = (entry: Entry) => needle !== '' && !matches(entry)
  const employees = plan.employees.filter((employee) => !hidden.includes(employee.id))

  const toggleEmployee = (id: number) =>
    storeHidden(hidden.includes(id) ? hidden.filter((other) => other !== id) : [...hidden, id])

  const storeHidden = (next: number[]) => {
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
      return {
        ...current,
        entries: [...current.entries.filter((e) => !keys.has(cellKey(e.employeeId, e.date))), ...saved],
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

    const id = `saved-${++notificationCount.current}`
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
      scrollToDate(addDays(weekOf(anchor)[0].iso, 7), true)
    } catch (e) {
      notifications.show({ color: 'red', message: messageOf(e) })
    }
  }

  const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
  const middle = addDays(visible.from, Math.floor((Date.parse(visible.to) - Date.parse(visible.from)) / 172800000))
  const title =
    view === 'week'
      ? `KW ${[...new Set([isoWeek(visible.from), isoWeek(visible.to)])].join('–')} · ${short(visible.from)}–${short(visible.to)}${year}`
      : `${MONTHS[Number(middle.slice(5, 7)) - 1]} ${year}`

  const filteredSite = plan.sites.find((site) => site.name.toLowerCase() === needle)
  const nameOf = (input: DayEntryInput) => (input.siteId === null ? input.type : (siteById.get(input.siteId)?.name ?? ''))

  const createSite = async (input: SiteInput) => {
    const site = await api.createSite(input)
    setPlan((current) =>
      current && { ...current, sites: [...current.sites, site].sort((a, b) => a.name.localeCompare(b.name, 'de')) },
    )
    return site
  }

  /** Saves a site and shows its new name in all cells at once. */
  const updateSite = async (id: number, input: SiteInput) => {
    const site = await api.updateSite(id, input)
    setPlan(
      (current) =>
        current && {
          ...current,
          sites: current.sites.map((other) => (other.id === id ? site : other)),
          entries: current.entries.map((entry) => (entry.siteId === id ? { ...entry, siteName: site.name } : entry)),
        },
    )
    return site
  }
  const shared = {
    employees,
    entriesOf,
    holidayByDate,
    today,
    isDimmed,
    linkNames: canEdit,
    onOpen: (employee: PlanEmployee, date: string) => setOpen({ employee, date }),
    onOpenSite: (siteId: number) => {
      const site = siteById.get(siteId)
      if (site) setShownSite({ site, editing: false })
    },
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
            onChange={(value) => changeZoom(value as View)}
            data={[
              { value: 'week', label: 'Woche' },
              { value: 'month', label: 'Monat' },
              { value: 'year', label: 'Jahr' },
            ]}
          />
          <Group gap={4}>
            <ActionIcon variant="default" size="lg" onClick={() => step(-1)} aria-label="Zurück">
              ‹
            </ActionIcon>
            <ActionIcon variant="default" size="lg" onClick={() => step(1)} aria-label="Weiter">
              ›
            </ActionIcon>
          </Group>
          {inYear(today) && (
            <Button
              variant="default"
              onClick={() => scrollToDate(view === 'week' ? weekOf(today)[0].iso : addDays(today, -3), true)}
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
          <DatePickerInput
            value={anchor}
            onChange={(value) => value && scrollToDate(value, true)}
            minDate={first}
            maxDate={last}
            valueFormat="DD.MM.YYYY"
            aria-label="Datum"
            w={130}
          />

          <Switch
            label="Wochenenden ausblenden"
            checked={foldWeekends}
            onChange={(event) => toggleWeekends(event.currentTarget.checked)}
          />

          <Menu closeOnItemClick={false} position="bottom-start" withinPortal>
            <Menu.Target>
              <Button variant="default">
                Mitarbeiter ({employees.length}/{plan.employees.length})
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Group gap={4} px="xs" py={4}>
                <Button size="compact-xs" variant="subtle" onClick={() => storeHidden([])}>
                  Alle auswählen
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => storeHidden(plan.employees.map((employee) => employee.id))}
                >
                  Alle abwählen
                </Button>
              </Group>
              <Menu.Divider />
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
              {filteredSite && canEdit && (
                <>
                  {' · '}
                  <a href={`#/baustellen/${filteredSite.id}`}>Auswertung öffnen</a>
                </>
              )}
            </Text>
          )}
        </Group>
        <ActivityLegend />
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

      <div className="plan-scroll" ref={scroller} onScroll={onScroll}>
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
        ) : (
          <TimelineMatrix days={yearDays} zoom={view} foldWeekends={foldWeekends} {...shared} />
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
                    () => [{ type: 'Urlaub', siteId: null, activity: null, startTime: null, endTime: null, note: null }],
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
                    () => [{ type: 'Krank', siteId: null, activity: null, startTime: null, endTime: null, note: null }],
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
                      label: singleEntries.map((e) => e.siteName ?? e.type).join(' / '),
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
          employees={plan.employees.filter((employee) =>
            [...selected].some((key) => parseKey(key).employeeId === employee.id),
          )}
          sites={plan.sites}
          onCreateSite={createSite}
          recentSites={recentSites}
          onClose={() => setAssigning(false)}
          onApply={async (template, add, choice) => {
            const changes = [...selected].map(parseKey).map(({ employeeId, date }) => {
              // Everybody gets their main activity, or the chosen one if they can do it.
              const employee = plan.employees.find((e) => e.id === employeeId)!
              const activity =
                choice !== 'main' && allowedActivities(employee).includes(choice) ? choice : employee.mainActivity
              const entry = { ...template, activity }
              return {
                employeeId,
                date,
                entries: add ? [...entriesOf(employeeId, date).map(toInput), entry] : [entry],
              }
            })
            const entry = template
            await save(changes, `${nameOf(entry)} in ${changes.length} Felder eingetragen.`)
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
            sites={plan.sites}
            onCreateSite={createSite}
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
                label: entries.map(nameOf).join(' / ') || 'leerer Tag',
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

      {shownSite &&
        (shownSite.editing ? (
          <SiteForm
            title="Baustelle bearbeiten"
            initial={toSiteInput(shownSite.site)}
            onClose={() => setShownSite(null)}
            onSave={async (input) => {
              await updateSite(shownSite.site.id, input)
              setShownSite(null)
              notifications.show({ message: 'Baustelle gespeichert.', color: 'green' })
            }}
          />
        ) : (
          <SiteSheet
            site={shownSite.site}
            canEdit={canEdit}
            onEdit={() => setShownSite({ ...shownSite, editing: true })}
            onClose={() => setShownSite(null)}
          />
        ))}    </div>
  )
}
