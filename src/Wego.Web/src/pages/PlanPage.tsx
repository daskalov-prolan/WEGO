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
  Tooltip,
} from '@mantine/core'
import { useWindowEvent } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, DayEntryInput, Entry, EntryType, Plan, PlanEmployee, Site, SiteInput, User } from '../api/types'
import { SiteForm } from '../components/SiteForm'
import { SiteSheet } from '../components/SiteSheet'
import { toSiteInput } from '../lib/sites'
import { ActivityIcon } from '../components/ActivityIcon'
import { PhaseActivities, type Phase } from '../components/ActivityPicker'
import { AssignSite } from '../components/AssignSite'
import {
  ABSENCE,
  ACTIVITIES,
  activityLabel,
  allowedActivities,
  defaultActivity,
  entryName,
  textOn,
  isOpen,
  worksInPhase,
} from '../lib/activities'
import { DayDetails } from '../components/DayDetails'
import { DayEditor } from '../components/DayEditor'
import { SiteTimeline, TimelineMatrix, type OpenTask, type SiteRow } from '../components/PlanMatrix'
import { SiteDayDialog } from '../components/SiteDayDialog'
import { ClipMenu } from '../components/CellMenu'
import { useStretch } from '../lib/stretch'
import { copyEntries, pasteChanges, setClip, useClip, type PasteTarget } from '../lib/clipboard'
import { dragSource, dropTarget, moveChanges, staysPut, type DayChange, type DragItem } from '../lib/dragPlan'
import {
  addDays,
  addMonths,
  daysOfYear,
  formatDate,
  isoWeek,
  MONTHS,
  todayIso,
  weekOf,
} from '../lib/dates'
import { openTasksBySite as openTasks } from '../lib/tasks'
import { cellKey, holidaysByDate, toInput } from '../lib/ui'
import { useIsPhone } from '../lib/useIsPhone'

interface Props {
  year: number
  /** Angebotsphase or Bauphase, as chosen in the menu; the construction phase without it. */
  phase?: Phase
  canEdit: boolean
  /** Urlaub and Krank are entered by Planer G only; everybody sees them in the plan. */
  canAbsence?: boolean
  /** Who is signed in: an employee in the plan sees their own vacation days below it. */
  user?: User
  /** Paging past December or before January: the plan of that year, opened at the day paged to. */
  onYearChange?: (year: number) => void
}

type View = 'week' | 'month'
type AbsenceType = Exclude<EntryType, 'Baustelle'>

const HIDDEN_KEY = 'wego.plan.hiddenEmployees'
const WEEKENDS_KEY = 'wego.plan.showWeekends'
const PERSPECTIVE_KEY = 'wego.plan.perspective'
// The first day in view when a site was opened from the plan: going back returns there.
const RETURN_KEY = 'wego.plan.returnTo'

function loadReturnDate(): string | null {
  try {
    return sessionStorage.getItem(RETURN_KEY)
  } catch {
    return null
  }
}

/** Rows of the plan: one per employee, or one per construction site. */
type Perspective = 'employees' | 'sites'

function loadPerspective(): Perspective {
  try {
    return localStorage.getItem(PERSPECTIVE_KEY) === 'sites' ? 'sites' : 'employees'
  } catch {
    return 'employees'
  }
}

/** Whether an entry is work of this phase: by its activity, or (without one) by the status of its site. */
function inPhase(entry: Entry, site: Site | undefined, phase: Phase) {
  if (entry.activity) return ACTIVITIES.find((activity) => activity.value === entry.activity)?.phase === phase
  // Done and cancelled sites were built (or would have been): their entries without an activity count there.
  const status = site?.status
  return status === phase || (phase === 'Bauphase' && status !== undefined && !isOpen(status))
}

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

/** One change of the plan: the days as they were and as they became, to take it back or do it again. */
interface Step {
  label: string
  before: DayChange[]
  after: DayChange[]
}

/**
 * "Planung": the plan of everybody as a timeline, the days of the year from left to right, scrolled
 * freely while the rows stay in view. The rows are the employees (with the sites in the cells) or the
 * construction sites (with the employees in the cells). Woche, Monat and Jahr are zoom levels.
 * Planners select cells to fill many days at once.
 */
export function PlanPage({ year, phase: chosenPhase = 'Bauphase', canEdit, canAbsence = false, user, onYearChange }: Props) {
  const first = `${year}-01-01`
  const last = `${year}-12-31`
  const today = todayIso()
  const isPhone = useIsPhone()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [chosenView, setChosenView] = useState<View>('week')
  // The days that are currently in view; follows the scrolling.
  // The plan opens at today (or, back from a site, where it was); one scrolls from there into the past or the future.
  const [returnDate] = useState(loadReturnDate)
  const start =
    returnDate && returnDate >= first && returnDate <= last ? returnDate : today >= first && today <= last ? today : first
  const [visible, setVisible] = useState({ from: start < first ? first : start, to: addDays(start, 13) })
  const anchor = visible.from
  const scroller = useRef<HTMLDivElement>(null)
  const notificationCount = useRef(0)
  // A scroll that has to wait until the table is drawn (first load, other zoom, weekends shown or folded).
  const pendingScroll = useRef<{ iso: string; smooth: boolean } | null>({ iso: anchor, smooth: false })
  // The first day next to the names, as last scrolled to or by: kept there when the table changes its size.
  const pinned = useRef(anchor)
  const [foldWeekends, setFoldWeekends] = useState(loadFoldWeekends)
  const [perspective, setPerspective] = useState<Perspective>(loadPerspective)
  // Plan by site: by default only sites that are not done or cancelled.
  const [openOnly, setOpenOnly] = useState(true)
  // The phase from the menu: the employees who work in it, and its sites and activities. Who does no offer
  // work does not see the offer phase (the server leaves it out of the plan, too).
  const phase: Phase = plan?.offerPhase === false ? 'Bauphase' : chosenPhase
  const [siteDay, setSiteDay] = useState<{ siteId: number; date: string } | null>(null)
  const [hidden, setHidden] = useState<number[]>(loadHidden)
  // The day open in the editor; addActivity: an activity dropped on it, added as a new row.
  const [open, setOpen] = useState<{ employee: PlanEmployee; date: string; addActivity?: Activity } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)
  // A site opened from a cell, and whether its form is open.
  const [shownSite, setShownSite] = useState<{ site: Site; editing: boolean } | null>(null)
  // Copied or cut entries, shared by all plan views.
  const clip = useClip()
  // An entry marked by a click: with the days that follow on at the same site it is one stretch.
  const [marked, setMarked] = useState<number | null>(null)
  const startStretch = useStretch()
  // The changes made since the plan was opened: taken back (undo) and done again (redo), newest last.
  const [history, setHistory] = useState<{ undo: Step[]; redo: Step[] }>({ undo: [], redo: [] })
  const [busy, setBusy] = useState(false)
  // The menu of a right click on a cell.
  // The menu of a right click on a cell of an employee or of a site; `entryId`: the click was on one entry.
  const [cellMenu, setCellMenu] = useState<{
    date: string
    x: number
    y: number
    entryId?: number
    employee?: PlanEmployee
    site?: Site
  } | null>(null)

  useEffect(() => {
    api.plan(year).then(setPlan, (e) => setError(messageOf(e)))
  }, [year])

  // The own vacation days of the year (see the line below the plan); counted from the plan as it changes.
  const ownId = user?.showInPlan ? user.id : null
  const [entitlement, setEntitlement] = useState<number | null>(null)
  useEffect(() => {
    if (ownId === null) return
    api.employeeReport(ownId, year).then(
      (report) => setEntitlement(report.vacation.entitlement),
      () => setEntitlement(null),
    )
  }, [ownId, year])

  // The way back is used once; opening the plan anew starts at today again.
  useEffect(() => {
    try {
      sessionStorage.removeItem(RETURN_KEY)
    } catch {
      // Without storage the plan simply starts at today.
    }
  }, [])

  const closeCellMenu = useCallback(() => setCellMenu(null), [])

  useWindowEvent('keydown', (event) => {
    if (event.key !== 'Escape') return
    if (selected.size > 0) setSelected(new Set())
    setMarked(null)
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

  // Vacation days taken this year, counted like the server does: Monday to Friday, each day once.
  const vacationUsed = useMemo(() => {
    const days = new Set<string>()
    for (const entry of plan?.entries ?? []) {
      const weekday = new Date(`${entry.date}T12:00:00`).getDay()
      if (entry.employeeId === ownId && entry.type === 'Urlaub' && weekday !== 0 && weekday !== 6) days.add(entry.date)
    }
    return days.size
  }, [plan, ownId])


  const siteById = useMemo(() => new Map((plan?.sites ?? []).map((site) => [site.id, site])), [plan])
  const yearDays = useMemo(() => daysOfYear(year), [year])

  // The plan by site: every site of the phase with entries of the shown employees, planned in this year, or
  // open with activities still to plan; in the order the work starts there.
  // The activities each open site still needs in its status: not marked as not needed and not planned yet
  // (counted over all entries, whoever is shown).
  const openTasksBySite = useMemo(() => (plan ? openTasks(plan.sites, plan.entries) : new Map<number, OpenTask[]>()), [plan])

  // Everybody who can be planned: the columns of the plan and the planners otherwise not shown.
  const everyone = useMemo(() => [...(plan?.employees ?? []), ...(plan?.planners ?? [])], [plan])
  // Only who works in the phase (see worksInPhase); the planners not shown otherwise only in the offer phase.
  const phaseEmployees = useMemo(
    () => (phase === 'Angebot' ? everyone : (plan?.employees ?? [])).filter((employee) => worksInPhase(employee, phase)),
    [plan, everyone, phase],
  )

  const siteRows = useMemo<SiteRow[]>(() => {
    if (!plan) return []
    const shown = new Set(phaseEmployees.filter((employee) => !hidden.includes(employee.id)).map((e) => e.id))
    const rows = new Map<number, SiteRow & { start: string }>()
    for (const site of plan.sites) {
      if (site.status !== phase) continue
      const plannedThisYear =
        site.plannedStart && site.plannedStart <= `${year}-12-31` && (site.plannedEnd ?? site.plannedStart) >= `${year}-01-01`
      // Planned for this year, or with activities still to plan (sites without dates go last).
      const tasks = openTasksBySite.get(site.id) ?? []
      if (plannedThisYear || tasks.length > 0)
        rows.set(site.id, { site, byDate: new Map(), start: site.plannedStart ?? '9999-12-31', openTasks: tasks })
    }
    for (const entry of plan.entries) {
      if (entry.siteId === null || !shown.has(entry.employeeId)) continue
      const site = siteById.get(entry.siteId)
      if (!site || (openOnly && !isOpen(site.status)) || !inPhase(entry, site, phase)) continue
      const row = rows.get(site.id) ?? { site, byDate: new Map(), start: entry.date, openTasks: openTasksBySite.get(site.id) ?? [] }
      if (entry.date < row.start) row.start = entry.date
      const list = row.byDate.get(entry.date)
      if (list) list.push(entry)
      else row.byDate.set(entry.date, [entry])
      rows.set(site.id, row)
    }
    return [...rows.values()].sort((a, b) => a.start.localeCompare(b.start) || a.site.name.localeCompare(b.site.name, 'de'))
  }, [plan, phase, phaseEmployees, hidden, siteById, year, openOnly, openTasksBySite])

  // Open sites with work before today: shown as a hint, since the plan always opens at today.
  const earlierWork = useMemo(() => {
    let earliest: string | null = null
    const sites = new Set<number>()
    for (const row of siteRows) {
      if (!isOpen(row.site.status)) continue
      for (const date of row.byDate.keys()) {
        if (date >= today) continue
        sites.add(row.site.id)
        if (!earliest || date < earliest) earliest = date
      }
    }
    return earliest ? { earliest, sites: sites.size } : null
  }, [siteRows, today])

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
      .filter((site): site is Site => site !== undefined && isOpen(site.status))
  }, [plan, anchor, siteById])

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
    pinned.current = iso
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
    if (next) pinned.current = next.from
    if (next && (next.from !== visible.from || next.to !== visible.to)) {
      setVisible(next)
    }
  }

  // Runs after every drawing of the table: carries out a scroll that had to wait for it.
  useLayoutEffect(() => {
    const pending = pendingScroll.current
    if (pending && scrollNow(pending.iso, pending.smooth)) pendingScroll.current = null
  })

  // Columns can still grow after the table is drawn (fonts, the column of open activities). The scroll position
  // in pixels then stays while the days move, without a scroll event: keep the same day next to the names.
  useEffect(() => {
    const element = scroller.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const keep = () => {
      const column = document.getElementById(`col-${pinned.current}`)
      const corner = element.querySelector<HTMLElement>('th.corner')
      if (!column || pendingScroll.current) return
      const left = column.offsetLeft - (corner?.offsetWidth ?? 0)
      if (Math.abs(element.scrollLeft - left) > 1) element.scrollLeft = left
    }
    const observer = new ResizeObserver(keep)
    for (const child of element.querySelectorAll('table, th.corner')) observer.observe(child)
    return () => observer.disconnect()
  }, [plan, perspective, chosenView, foldWeekends])

  // Another phase from the menu: what was selected or marked belongs to the other one.
  const [shownPhase, setShownPhase] = useState(phase)
  if (shownPhase !== phase) {
    setShownPhase(phase)
    setSelected(new Set())
    setMarked(null)
  }

  const changePerspective = (next: Perspective) => {
    pendingScroll.current = { iso: anchor, smooth: false }
    setSelected(new Set())
    setMarked(null)
    setPerspective(next)
    try {
      localStorage.setItem(PERSPECTIVE_KEY, next)
    } catch {
      // Without storage the choice lasts until the page is reloaded.
    }
  }

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

  /** The plan of another year, opened at this day (the plan holds one year at a time). */
  const openInYear = (iso: string) => {
    try {
      sessionStorage.setItem(RETURN_KEY, iso)
    } catch {
      // Without storage the other year opens at its first day.
    }
    onYearChange?.(Number(iso.slice(0, 4)))
  }

  /**
   * A week or a month on or back. Past the end of December (or once December is fully in view) the next
   * year follows with January; before January the previous year with December.
   */
  const step = (direction: 1 | -1) => {
    const target = view === 'week' ? addDays(weekOf(anchor)[0].iso, 7 * direction) : addMonths(anchor, direction)
    if (onYearChange && direction === 1 && (target > last || visible.to >= last)) {
      openInYear(target > last ? target : `${year + 1}-01-01`)
      return
    }
    if (onYearChange && direction === -1 && target < first) {
      openInYear(target)
      return
    }
    scrollToDate(target, true)
  }

  const goToday = () => (inYear(today) ? scrollToDate(today, true) : openInYear(today))

  if (error) return <p className="error page">{error}</p>
  if (!plan || plan.year !== year) return null

  const entriesOf = (employeeId: number, date: string) => entriesByCell.get(cellKey(employeeId, date)) ?? []
  // Work of the other phase stays visible, but pale: the day is not free.
  const isDimmed = (entry: Entry) =>
    entry.type === 'Baustelle' && !inPhase(entry, entry.siteId === null ? undefined : siteById.get(entry.siteId), phase)
  const employees = phaseEmployees.filter((employee) => !hidden.includes(employee.id))

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

  /** Saves days and puts the change on the history, to take it back. Rejects with the server's message. */
  const save = async (changes: DayChange[], message: string) => {
    const previous = changes.map((change) => ({
      ...change,
      entries: entriesOf(change.employeeId, change.date).map(toInput),
    }))
    merge(changes, await api.saveDays(changes))
    // A new change ends what could be done again.
    setHistory((current) => ({ undo: [...current.undo, { label: message, before: previous, after: changes }], redo: [] }))
    notifications.show({ id: `saved-${++notificationCount.current}`, autoClose: 4000, message })
  }

  /** Takes back the newest change: its days as they were before. */
  const undo = async () => {
    const step = history.undo.at(-1)
    if (!step || busy) return
    setBusy(true)
    try {
      merge(step.before, await api.saveDays(step.before))
      setHistory((current) => ({ undo: current.undo.slice(0, -1), redo: [...current.redo, step] }))
      notifications.show({ message: `Rückgängig: ${step.label}`, autoClose: 3000 })
    } finally {
      setBusy(false)
    }
  }

  /** Does the newest change taken back again. */
  const redo = async () => {
    const step = history.redo.at(-1)
    if (!step || busy) return
    setBusy(true)
    try {
      merge(step.after, await api.saveDays(step.after))
      setHistory((current) => ({ undo: [...current.undo, step], redo: current.redo.slice(0, -1) }))
      notifications.show({ message: `Wiederhergestellt: ${step.label}`, autoClose: 3000 })
    } finally {
      setBusy(false)
    }
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

  const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
  const middle = addDays(visible.from, Math.floor((Date.parse(visible.to) - Date.parse(visible.from)) / 172800000))
  const title =
    view === 'week'
      ? `KW ${[...new Set([isoWeek(visible.from), isoWeek(visible.to)])].join('–')} · ${short(visible.from)}–${short(visible.to)}${year}`
      : `${MONTHS[Number(middle.slice(5, 7)) - 1]} ${year}`

  /** Puts these employees on a site on that day, each with their own activity there, next to what they have. */
  const addToSite = async (site: Site, employeeIds: number[], date: string) => {
    const changes = employeeIds.map((employeeId) => {
      const employee = everyone.find((candidate) => candidate.id === employeeId)!
      return {
        employeeId,
        date,
        entries: [
          ...entriesOf(employeeId, date).map(toInput),
          {
            type: 'Baustelle' as const,
            siteId: site.id,
            activity: defaultActivity(employee, site.status),
            startTime: null,
            endTime: null,
            note: null,
            noteImportant: false,
          },
        ],
      }
    })
    const who = changes.length === 1 ? everyone.find((e) => e.id === employeeIds[0])!.name : `${changes.length} Mitarbeiter`
    await save(changes, `${who} auf ${site.name} eingeplant, ${formatDate(date)}.`)
  }

  /** A working day: no weekend, no public holiday. */
  const isWorkday = (iso: string) => {
    const weekday = new Date(`${iso}T12:00:00`).getDay()
    return weekday !== 0 && weekday !== 6 && holidayByDate.get(iso)?.kind !== 'Feiertag'
  }

  /**
   * The stretch of an entry: the same employee at the same site with the same activity on the working days
   * before and after it, one after the other (weekends and public holidays in between do not break it).
   */
  const stretchOf = (entry: Entry) => {
    const same = (iso: string) =>
      entriesOf(entry.employeeId, iso).find(
        (other) => other.type === entry.type && other.siteId === entry.siteId && other.activity === entry.activity,
      )
    const step = (iso: string, direction: 1 | -1) => {
      let next = addDays(iso, direction)
      while (inYear(next) && !isWorkday(next) && !same(next)) next = addDays(next, direction)
      return next
    }
    const ids = new Set([entry.id])
    let from = entry.date
    let to = entry.date
    let first = entry
    let last = entry
    for (let before = same(step(from, -1)); before && inYear(before.date); before = same(step(from, -1))) {
      ids.add(before.id)
      from = before.date
      first = before
    }
    for (let after = same(step(to, 1)); after && inYear(after.date); after = same(step(to, 1))) {
      ids.add(after.id)
      to = after.date
      last = after
    }
    return { ids, from, to, first, last }
  }

  const markedEntry = marked === null ? undefined : plan.entries.find((entry) => entry.id === marked)
  const markedStretch = markedEntry ? stretchOf(markedEntry) : undefined

  /**
   * A stretch dragged to new first and last days: working days that come in get the same site, activity and
   * time (not the note); days that drop out lose the entry. A day at that site already stays as it is.
   */
  const restretch = async (entry: Entry, from: string, to: string) => {
    const current = stretchOf(entry)
    const changes: DayChange[] = []
    for (let iso = from; iso <= to; iso = addDays(iso, 1)) {
      if ((iso >= current.from && iso <= current.to) || !isWorkday(iso)) continue
      const there = entriesOf(entry.employeeId, iso)
      if (there.some((other) => other.type === entry.type && other.siteId === entry.siteId && (entry.siteId !== null || other.activity === entry.activity))) continue
      changes.push({
        employeeId: entry.employeeId,
        date: iso,
        entries: [...there.map(toInput), { ...toInput(entry), note: null, noteImportant: false }],
      })
    }
    for (let iso = current.from; iso <= current.to; iso = addDays(iso, 1)) {
      if (iso >= from && iso <= to) continue
      const there = entriesOf(entry.employeeId, iso)
      if (!there.some((other) => current.ids.has(other.id))) continue
      changes.push({ employeeId: entry.employeeId, date: iso, entries: there.filter((other) => !current.ids.has(other.id)).map(toInput) })
    }
    if (changes.length === 0) return
    // The marked entry may be one of those that drop out.
    if (marked !== null && !(entry.date >= from && entry.date <= to)) setMarked(null)
    const name = entryName(entry)
    await save(changes, `${name}: ${formatDate(from)} bis ${formatDate(to)}.`)
  }

  /** Adds the clipboard to these cells (see pasteChanges); cut entries leave their day in the same step. */
  const paste = async (targets: PasteTarget[]) => {
    if (!clip) return
    const changes = pasteChanges(clip, targets, entriesOf, everyone, siteById)
    await save(changes, `${clip.label} in ${targets.length} ${targets.length === 1 ? 'Feld' : 'Felder'} eingefügt.`)
    if (clip.cut) setClip(null)
    setSelected(new Set())
  }
  const toTargets = (keys: string[]): PasteTarget[] => keys.map(parseKey).map(({ employeeId, date }) => ({ employeeId, date }))

  const fail = (e: unknown) => notifications.show({ color: 'red', message: messageOf(e) })

  /** Deletes entries (from the menu of a right click): each of their days keeps the rest. */
  const remove = async (entries: Entry[]) => {
    const ids = new Set(entries.map((entry) => entry.id))
    const days = new Map(entries.map((entry) => [cellKey(entry.employeeId, entry.date), entry]))
    const changes = [...days.values()].map(({ employeeId, date }) => ({
      employeeId,
      date,
      entries: entriesOf(employeeId, date)
        .filter((other) => !ids.has(other.id))
        .map(toInput),
    }))
    const names = [...new Set(entries.map((entry) => entryName(entry)))].join(' / ')
    await save(changes, `Gelöscht: ${names}.`)
    setMarked(null)
  }

  /** Urlaub or Krank as the whole day: what was planned that day gives way. */
  const absenceDay = (type: AbsenceType): DayEntryInput[] => [
    { type, siteId: null, activity: null, startTime: null, endTime: null, note: null, noteImportant: false },
  ]
  const absenceMessage = (type: AbsenceType, days: number) =>
    `${days} ${days === 1 ? 'Tag' : 'Tage'} als ${type === 'Urlaub' ? 'Urlaub' : 'krank'} eingetragen.`

  /** A click on Urlaub / Krank above the plan: into the selected fields, else how to use it. */
  const markAbsence = (type: AbsenceType) => {
    if (selected.size === 0) {
      notifications.show({ message: `${type} auf einen Tag ziehen, oder zuerst Felder auswählen.`, autoClose: 3000 })
      return
    }
    applyToSelection(() => absenceDay(type), absenceMessage(type, selected.size))
  }

  /** Dragging an end of the marked stretch along its row: the employee's row ('e') or the site's row ('s'). */
  const onStretchStart = (rows: 'e' | 's') =>
    canEdit && markedStretch
      ? (entry: Entry, side: 'left' | 'right', event: PointerEvent) =>
          startStretch(
            {
              row: rows === 'e' ? `e${entry.employeeId}` : `s${entry.siteId}`,
              from: markedStretch.from,
              to: markedStretch.to,
              side,
              done: (from, to) => {
                restretch(entry, from, to).catch(fail)
              },
            },
            event,
          )
      : undefined
  const canDo = (employee: PlanEmployee, activity: Activity, status?: Site['status']) =>
    allowedActivities(employee, status).includes(activity)

  /**
   * Plan by employee: an entry moves to this employee and day; an activity from above the plan opens the
   * day with it as a new row, to choose or create its site there or leave it open (as often as needed, e.g.
   * two visits); Urlaub or Krank becomes the whole day.
   */
  const dropOnEmployee = (employee: PlanEmployee, date: string) =>
    dropTarget(
      (item: DragItem) =>
        item.kind === 'absence'
          ? canAbsence
          : item.kind === 'activity'
            ? canDo(employee, item.activity)
            : item.kind === 'entry' &&
              !staysPut(item.entry, { employeeId: employee.id, date, siteId: item.entry.siteId }) &&
              (item.entry.activity === null || canDo(employee, item.entry.activity)),
      (item: DragItem) => {
        if (item.kind === 'absence') {
          const message = `${employee.name}: ${absenceMessage(item.type, 1)}`
          save([{ employeeId: employee.id, date, entries: absenceDay(item.type) }], message).catch(fail)
          return
        }
        if (item.kind === 'activity') {
          setOpen({ employee, date, addActivity: item.activity })
          return
        }
        if (item.kind !== 'entry') return
        const { entry } = item
        const changes = moveChanges(entry, { employeeId: employee.id, date, siteId: entry.siteId, activity: entry.activity }, entriesOf)
        save(changes, `${entryName(entry)} verschoben: ${employee.name}, ${formatDate(date)}.`).catch(fail)
      },
      canEdit,
    )

  /**
   * Plan by site: an entry moves to this site and day; an employee from the buttons above is added there
   * (unless already on this site that day).
   */
  const dropOnSite = (site: Site, date: string) =>
    dropTarget(
      (item: DragItem) =>
        isOpen(site.status) &&
        (item.kind === 'employee'
          ? !entriesOf(item.employeeId, date).some((entry) => entry.siteId === site.id)
          : item.kind === 'entry' &&
            item.entry.type === 'Baustelle' &&
            !staysPut(item.entry, { employeeId: item.entry.employeeId, date, siteId: site.id })),
      (item: DragItem) => {
        if (item.kind === 'employee') {
          addToSite(site, [item.employeeId], date).catch(fail)
          return
        }
        if (item.kind !== 'entry') return
        const { entry } = item
        const employee = everyone.find((candidate) => candidate.id === entry.employeeId)
        if (!employee) return
        // The activity stays if it belongs to the status of the new site, else the employee's own one there.
        const activity =
          entry.activity && canDo(employee, entry.activity, site.status) ? entry.activity : defaultActivity(employee, site.status)
        const changes = moveChanges(entry, { employeeId: employee.id, date, siteId: site.id, activity }, entriesOf)
        save(changes, `${employee.name} verschoben: ${site.name}, ${formatDate(date)}.`).catch(fail)
      },
      canEdit,
    )

  /**
   * An activity from above the plan dropped on an entry of a site: the employee does that there instead, if it
   * is one of theirs and fits the site.
   */
  const dropOnEntry = (entry: Entry) =>
    dropTarget(
      (item: DragItem) => {
        if (item.kind !== 'activity' || entry.type !== 'Baustelle' || item.activity === entry.activity) return false
        const employee = everyone.find((candidate) => candidate.id === entry.employeeId)
        const site = entry.siteId === null ? undefined : siteById.get(entry.siteId)
        return employee !== undefined && canDo(employee, item.activity, site && isOpen(site.status) ? site.status : undefined)
      },
      (item: DragItem) => {
        if (item.kind !== 'activity') return
        const entries = entriesOf(entry.employeeId, entry.date).map((other) =>
          other.id === entry.id ? { ...toInput(other), activity: item.activity } : toInput(other),
        )
        save([{ employeeId: entry.employeeId, date: entry.date, entries }], `${entry.employeeName}: ${item.label}.`).catch(fail)
      },
      canEdit,
    )

  const nameOf = (input: DayEntryInput) =>
    input.siteId !== null ? (siteById.get(input.siteId)?.name ?? '') : input.type === 'Baustelle' ? (activityLabel(input.activity) ?? '') : input.type

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
      // Planners go straight to the page of the site; employees (who have no such page) see its record here.
      if (canEdit) {
        try {
          sessionStorage.setItem(RETURN_KEY, anchor)
        } catch {
          // Without storage the plan starts at today when coming back.
        }
        window.location.hash = `#/baustellen/${siteId}`
        return
      }
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
        <Group gap="xs" wrap="wrap" className="plan-controls">
          <SegmentedControl
            size="sm"
            value={perspective}
            onChange={(value) => changePerspective(value as Perspective)}
            data={[
              { value: 'employees', label: 'Nach Mitarbeiter' },
              { value: 'sites', label: 'Nach Baustelle' },
            ]}
            color="wego"
          />
          <Menu closeOnItemClick={false} position="bottom-start" withinPortal>
            <Menu.Target>
              <Button size="sm" variant="default">
                Mitarbeiter ({employees.length}/{phaseEmployees.length})
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
                  onClick={() => storeHidden(everyone.map((employee) => employee.id))}
                >
                  Alle abwählen
                </Button>
              </Group>
              <Menu.Divider />
              {phaseEmployees.map((employee) => (
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
          {perspective === 'sites' && earlierWork && (
            <Tooltip
              label={`${earlierWork.sites} offene Baustellen haben Einsätze vor heute, der früheste am ${formatDate(earlierWork.earliest)}. Klicken springt dorthin.`}
              multiline
              w={260}
            >
              <Button
                size="sm"
                variant="light"
                color="orange"
                className="earlier-work"
                onClick={() => scrollToDate(earlierWork.earliest, true)}
              >
                ◀ Frühere Einsätze: {earlierWork.sites}
              </Button>
            </Tooltip>
          )}
          {/* Zoom, paging and the shown weeks at the right, before the switches. */}
          <Group gap="sm" wrap="nowrap" ml="auto">
            <SegmentedControl
              size="sm"
              value={view}
              onChange={(value) => changeZoom(value as View)}
              data={[
                { value: 'week', label: 'Woche' },
                { value: 'month', label: 'Monat' },
              ]}
            />
            <Button size="sm" color="wegoRed.6" onClick={goToday}>
              Heute
            </Button>
            <Text fw={700} c="wego.9" className="plan-title">
              {title}
            </Text>
            {/* The arrows right after the weeks they move. */}
            <Group gap={4} wrap="nowrap">
              <ActionIcon variant="default" size="input-sm" onClick={() => step(-1)} aria-label="Zurück">
                ‹
              </ActionIcon>
              <ActionIcon variant="default" size="input-sm" onClick={() => step(1)} aria-label="Weiter">
                ›
              </ActionIcon>
            </Group>
            {perspective === 'sites' && (
              <Switch
                size="sm"
                label="Nur unerledigte"
                checked={openOnly}
                onChange={(event) => setOpenOnly(event.currentTarget.checked)}
              />
            )}
            <Switch
              size="sm"
              label="Wochenenden ausblenden"
              checked={foldWeekends}
              onChange={(event) => toggleWeekends(event.currentTarget.checked)}
            />
          </Group>
        </Group>

        {/* Undo and redo, the activities of the phase right above the plan, Urlaub and Krank at the right end (Planer G). */}
        <div className="activity-row">
          {canEdit && (
            <Group gap={4} wrap="nowrap" className="history-buttons">
              <Tooltip label={history.undo.at(-1) ? `Rückgängig: ${history.undo.at(-1)!.label}` : 'Nichts rückgängig zu machen'}>
                <ActionIcon
                  variant="default"
                  size="input-sm"
                  radius="xl"
                  aria-label="Rückgängig"
                  disabled={history.undo.length === 0 || busy}
                  onClick={() => undo().catch(fail)}
                >
                  ↶
                </ActionIcon>
              </Tooltip>
              <Tooltip label={history.redo.at(-1) ? `Wiederherstellen: ${history.redo.at(-1)!.label}` : 'Nichts wiederherzustellen'}>
                <ActionIcon
                  variant="default"
                  size="input-sm"
                  radius="xl"
                  aria-label="Wiederherstellen"
                  disabled={history.redo.length === 0 || busy}
                  onClick={() => redo().catch(fail)}
                >
                  ↷
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
          <PhaseActivities
            phase={phase}
            // The activities go onto an employee's day (the site is chosen or created there), or onto an entry to
            // change what the employee does there.
            draggable={canEdit && !isPhone}
          />
          {canAbsence && perspective === 'employees' && (
            <span className="flow-steps absence-steps" role="group" aria-label="Abwesenheit eintragen">
              {(['Urlaub', 'Krank'] as const).map((type) => (
                <Tooltip
                  key={type}
                  label={`Auf einen Tag eines Mitarbeiters ziehen, oder Felder auswählen und hier klicken: ${type}`}
                  multiline
                  w={260}
                >
                  <button
                    type="button"
                    className="flow-step drag-source"
                    style={
                      {
                        '--entry-bg': ABSENCE.tint,
                        '--entry-strong': ABSENCE.background,
                        '--entry-text': textOn(ABSENCE.background),
                      } as CSSProperties
                    }
                    onClick={() => markAbsence(type)}
                    {...dragSource({ kind: 'absence', type }, !isPhone)}
                  >
                    {type === 'Urlaub' && <ActivityIcon type={type} size={11} />}
                    {type}
                  </button>
                </Tooltip>
              ))}
            </span>
          )}
        </div>
        {canEdit && perspective === 'sites' && !isPhone && employees.length > 0 && (
          <div className="employee-palette" role="group" aria-label="Mitarbeiter zum Einplanen">
            <Text size="xs" c="dimmed">
              Auf eine Baustelle ziehen:
            </Text>
            {employees.map((employee) => {
              const main = ACTIVITIES.find((activity) => activity.value === employee.mainActivity)
              return (
                <span
                  key={employee.id}
                  className="palette-employee drag-source"
                  title={`${employee.name} auf einen Tag einer Baustelle ziehen`}
                  style={main ? { borderColor: main.background } : undefined}
                  {...dragSource({ kind: 'employee', employeeId: employee.id, name: employee.name }, true)}
                >
                  {employee.name}
                </span>
              )
            })}
          </div>
        )}
        {canEdit && isPhone && selected.size === 0 && perspective === 'employees' && (
          <Text size="xs" c="dimmed">
            Tipp: Feld lange drücken, um mehrere Tage auszuwählen.
          </Text>
        )}
      </div>

      <div
        className="plan-scroll"
        ref={scroller}
        onScroll={onScroll}
        // Strg+C / Strg+X: the marked entry; Strg+V: into the selected cells.
        onKeyDown={(event) => {
          if (!canEdit || !(event.ctrlKey || event.metaKey)) return
          const key = event.key.toLowerCase()
          if ((key === 'c' || key === 'x') && markedEntry) {
            event.preventDefault()
            copyEntries([markedEntry], key === 'x')
            notifications.show({ message: key === 'x' ? 'Ausgeschnitten.' : 'Kopiert.', autoClose: 2000 })
          } else if (key === 'v' && clip && selected.size > 0) {
            event.preventDefault()
            paste(toTargets([...selected])).catch(fail)
          }
        }}
      >
        {everyone.length === 0 ? (
          <p className="page">
            Noch keine Mitarbeiter angelegt.
            {canEdit && (
              <>
                {' '}
                <a href="#/verwaltung">Zur Verwaltung</a>
              </>
            )}
          </p>
        ) : perspective === 'employees' ? (
          <TimelineMatrix
            days={yearDays}
            zoom={view}
            foldWeekends={foldWeekends}
            dropOn={canEdit ? dropOnEmployee : undefined}
            dropOnEntry={canEdit ? dropOnEntry : undefined}
            onCellMenu={canEdit ? (employee, date, { x, y, entryId }) => setCellMenu({ employee, date, x, y, entryId }) : undefined}
            marked={markedStretch && { ids: markedStretch.ids, first: markedStretch.first.id, last: markedStretch.last.id }}
            onMark={canEdit ? (entry) => setMarked(entry?.id ?? null) : undefined}
            onStretchStart={onStretchStart('e')}
            {...shared}
          />
        ) : (
          <SiteTimeline
            days={yearDays}
            rows={siteRows}
            holidayByDate={holidayByDate}
            today={today}
            zoom={view}
            foldWeekends={foldWeekends}
            onOpenCell={(site, date) => setSiteDay({ siteId: site.id, date })}
            onOpenSite={shared.onOpenSite}
            dropOn={canEdit ? dropOnSite : undefined}
            dropOnEntry={canEdit ? dropOnEntry : undefined}
            onCellMenu={canEdit ? (site, date, { x, y, entryId }) => setCellMenu({ site, date, x, y, entryId }) : undefined}
            marked={markedStretch && { ids: markedStretch.ids, first: markedStretch.first.id, last: markedStretch.last.id }}
            onMark={canEdit ? (entry) => setMarked(entry?.id ?? null) : undefined}
            onStretchStart={onStretchStart('s')}
          />
        )}
      </div>

      {ownId !== null && entitlement !== null && (
        <div className="vacation-line" aria-label="Eigene Urlaubstage">
          <span>
            Urlaub {year}: genommen <strong>{vacationUsed}</strong> von <strong>{entitlement}</strong> Urlaubstagen
          </span>
          <span className={entitlement - vacationUsed < 0 ? 'vacation-left over' : 'vacation-left'}>
            verbleibende Urlaubstage: <strong>{entitlement - vacationUsed}</strong>
          </span>
        </div>
      )}

      {selected.size > 0 && perspective === 'employees' && (
        <Paper className="selection-bar" shadow="lg" p="sm" withBorder>
          <Group gap="xs" justify="space-between" wrap="wrap">
            <Text fw={700} size="sm">
              {selected.size} {selected.size === 1 ? 'Feld' : 'Felder'} ausgewählt
            </Text>
            <Group gap={6} wrap="wrap">
              <Button size="xs" onClick={() => setAssigning(true)}>
                Baustelle …
              </Button>
              {singleEntries.length > 0 && (
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => {
                    copyEntries(singleEntries, false)
                    notifications.show({ message: 'Kopiert. Felder auswählen und „Einfügen“ wählen.', autoClose: 3000 })
                  }}
                >
                  Kopieren
                </Button>
              )}
              {clip && (
                <Tooltip label={clip.label}>
                  <Button size="xs" variant="default" onClick={() => paste(toTargets([...selected])).catch(fail)}>
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
          employees={everyone.filter((employee) =>
            [...selected].some((key) => parseKey(key).employeeId === employee.id),
          )}
          sites={plan.sites}
          onCreateSite={createSite}
          onUpdateSite={updateSite}
          recentSites={recentSites}
          onClose={() => setAssigning(false)}
          onApply={async (template, add, choice) => {
            const changes = [...selected].map(parseKey).map(({ employeeId, date }) => {
              // Everybody gets their main activity, or the chosen one if they can do it.
              const employee = everyone.find((e) => e.id === employeeId)!
              const status = template.siteId === null ? undefined : siteById.get(template.siteId)?.status
              const activity =
                choice !== 'main' && allowedActivities(employee, status).includes(choice)
                  ? choice
                  : defaultActivity(employee, status)
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
            addActivity={open.addActivity}
            entries={entriesOf(open.employee.id, open.date)}
            sites={plan.sites}
            onCreateSite={createSite}
            onUpdateSite={updateSite}
            canAbsence={canAbsence}
            onClose={() => setOpen(null)}
            onSave={async (entries) => {
              await save(
                [{ employeeId: open.employee.id, date: open.date, entries }],
                `${open.employee.name}: Tag gespeichert.`,
              )
              setOpen(null)
            }}
            onCopy={(entries) => {
              // The rows of the editor as entries of this employee and day (saved or not).
              copyEntries(
                entries.map((entry, index) => ({
                  ...entry,
                  id: -(index + 1),
                  employeeId: open.employee.id,
                  employeeName: open.employee.name,
                  date: open.date,
                  siteName: entry.siteId === null ? null : nameOf(entry),
                })),
                false,
              )
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
        ))}
      {cellMenu &&
        (() => {
          const { employee, site, date } = cellMenu
          const all = employee
            ? entriesOf(employee.id, date)
            : (siteRows.find((row) => row.site.id === site?.id)?.byDate.get(date) ?? [])
          const one = all.find((entry) => entry.id === cellMenu.entryId)
          // A cell of the selection pastes into all selected cells, any other cell only into itself; a cell
          // of a site gives the site, a cell of an employee the employee.
          const targets: PasteTarget[] = employee
            ? selected.has(cellKey(employee.id, date))
              ? toTargets([...selected])
              : [{ employeeId: employee.id, date }]
            : [{ siteId: site!.id, date }]
          return (
            <ClipMenu
              x={cellMenu.x}
              y={cellMenu.y}
              onClose={closeCellMenu}
              one={one}
              all={all}
              pasteLabel={targets.length > 1 ? `Einfügen in ${targets.length} Felder` : 'Einfügen'}
              onPaste={() => {
                paste(targets).catch(fail)
              }}
              onOpenSite={shared.onOpenSite}
              onDelete={(entries) => remove(entries).catch(fail)}
            />
          )
        })()}
      {siteDay && siteById.get(siteDay.siteId) && (
        <SiteDayDialog
          site={siteById.get(siteDay.siteId)!}
          date={siteDay.date}
          entries={plan.entries.filter(
            (entry) =>
              entry.siteId === siteDay.siteId &&
              entry.date === siteDay.date &&
              employees.some((employee) => employee.id === entry.employeeId),
          )}
          employees={employees}
          canEdit={canEdit}
          onClose={() => setSiteDay(null)}
          onOpenSite={() => shared.onOpenSite(siteDay.siteId)}
          onEditDay={(employee) => {
            setSiteDay(null)
            setOpen({ employee, date: siteDay.date })
          }}
          onAdd={(employeeIds) => addToSite(siteById.get(siteDay.siteId)!, employeeIds, siteDay.date)}
          onRemove={async (removed) => {
            await save(
              [
                {
                  employeeId: removed.employeeId,
                  date: removed.date,
                  entries: entriesOf(removed.employeeId, removed.date)
                    .filter((entry) => entry.id !== removed.id)
                    .map(toInput),
                },
              ],
              `${removed.employeeName} von ${removed.siteName} entfernt.`,
            )
          }}
        />
      )}    </div>
  )
}
