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
  UnstyledButton,
} from '@mantine/core'
import { useWindowEvent } from '@mantine/hooks'
import { HOME_EVENT } from '../lib/home'
import { notifications } from '@mantine/notifications'
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, CalendarNote, DayEntryInput, Entry, EntryType, Plan, PlanEmployee, Site, SiteInput, User } from '../api/types'
import { SiteForm } from '../components/SiteForm'
import { StandardFlowDialog } from '../components/StandardFlowDialog'
import { forgetHandedUndo, handedUndo } from '../lib/undoHandoff'
import { YearPicker } from '../components/YearPicker'
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
  isFree,
  isOpen,
  isReservation,
  worksInPhase,
} from '../lib/activities'
import { DayDetails } from '../components/DayDetails'
import { PlanSearch } from '../components/PlanSearch'
import { DayEditor } from '../components/DayEditor'
import { shortNames, SiteTimeline, TimelineMatrix, type SiteRow } from '../components/PlanMatrix'
import { SiteDayDialog } from '../components/SiteDayDialog'
import { CellMenu, ClipMenu } from '../components/CellMenu'
import { NoteDialog, NoteView } from '../components/CalendarNotes'
import { useStretch } from '../lib/stretch'
import { copyEntries, pasteChanges, setClip, useClip, type PasteTarget } from '../lib/clipboard'
import { dragSource, dropTarget, moveChanges, staysPut, type DayChange, type DragItem } from '../lib/dragPlan'
import {
  addDays,
  PLAN_YEARS,
  addMonths,
  daysOfYear,
  formatDate,
  isoWeek,
  HALF_DAYS,
  MONTHS,
  todayIso,
  weekOf,
} from '../lib/dates'
import { cellKey, holidaysByDate, onDay, toInput } from '../lib/ui'
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

// The site searched for, handed to the plan of another year (it opens anew): its id and the day to show.
const FOUND_KEY = 'wego.plan.found'

function loadFound(): { siteId: number; day: string } | null {
  try {
    const stored = sessionStorage.getItem(FOUND_KEY)
    sessionStorage.removeItem(FOUND_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

/**
 * The days in view above the plan ("KW 45–46 · 02.11.–15.11.2026", or the month): it follows the scrolling by
 * itself, without the plan being drawn anew.
 */
function PlanTitle({
  subscribe,
  getVisible,
  view,
  year,
}: {
  subscribe: (listener: () => void) => () => void
  getVisible: () => { from: string; to: string }
  view: View
  year: number
}) {
  const visible = useSyncExternalStore(subscribe, getVisible)
  const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
  if (view !== 'week') {
    const middle = addDays(visible.from, Math.floor((Date.parse(visible.to) - Date.parse(visible.from)) / 172800000))
    return <>{`${MONTHS[Number(middle.slice(5, 7)) - 1]} ${year}`}</>
  }
  // The calendar week in red, as everywhere.
  return (
    <>
      <span className="kw">KW {[...new Set([isoWeek(visible.from), isoWeek(visible.to)])].join('–')}</span> ·{' '}
      {short(visible.from)}–{short(visible.to)}
      {year}
    </>
  )
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
  // A day without activity on an offer site is reserved for its construction: it belongs to the Bauphase.
  if (entry.type === 'Baustelle' && site?.status === 'Angebot') return phase === 'Bauphase'
  // Done and cancelled sites were built (or would have been): their entries without an activity count there.
  const status = site?.status
  return status === phase || (phase === 'Bauphase' && status !== undefined && !isOpen(status))
}

const SCALE_KEY = 'wego.plan.scale'
/** How big the plan is shown, in per cent: 60 to 150 in steps of 10. */
const SCALES = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150]

function loadScale(): number {
  try {
    const saved = Number(localStorage.getItem(SCALE_KEY))
    return SCALES.includes(saved) ? saved : 100
  } catch {
    return 100
  }
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

/** The year of the plan, chosen here and not in the header (as in Mein Plan). */
function YearSelect({ year, onChange, small = false }: { year: number; onChange?: (year: number) => void; small?: boolean }) {
  if (!onChange) return null
  return (
    <YearPicker
      year={year}
      years={[...PLAN_YEARS, year]}
      onChange={onChange}
      size={small ? 'xs' : 'sm'}
      w={small ? 82 : undefined}
    />
  )
}

/**
 * "Planung": the plan of everybody as a timeline, the days of the year from left to right, scrolled
 * freely while the rows stay in view. The rows are the employees (with the sites in the cells) or the
 * construction sites (with the employees in the cells). Woche, Monat and Jahr are zoom levels.
 * Planners select cells to fill many days at once.
 */
export function PlanPage({ year, phase: chosenPhase = 'Bauphase', canEdit, canAbsence = false, onYearChange }: Props) {
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
  // The days in view change with every move: kept outside the state, so that scrolling draws nothing anew. Only
  // the title follows them (see PlanTitle); the plan is drawn anew when the days filled in have to move along.
  const opening = start < first ? first : start
  const visibleRef = useRef({ from: opening, to: addDays(opening, 13) })
  const visibleListeners = useRef(new Set<() => void>())
  // The days filled in (see MatrixProps.live): eight weeks on each side of those in view.
  const around = (shown: { from: string; to: string }) => ({ from: addDays(shown.from, -56), to: addDays(shown.to, 56) })
  const [live, setLive] = useState(() => around({ from: opening, to: addDays(opening, 13) }))
  const liveRef = useRef(live)
  /**
   * New days in view. Near the edge of the days filled in, these move along: at once for a jump (the plan is
   * drawn before it goes there), else in the background.
   */
  const setVisible = (next: { from: string; to: string }, jump = false) => {
    const current = visibleRef.current
    if (current.from !== next.from || current.to !== next.to) {
      visibleRef.current = next
      for (const listener of visibleListeners.current) listener()
    }
    const filled = liveRef.current
    if (next.from >= addDays(filled.from, 21) && next.to <= addDays(filled.to, -21)) return
    liveRef.current = around(next)
    if (jump) setLive(liveRef.current)
    else startTransition(() => setLive(liveRef.current))
  }
  const subscribeVisible = useCallback((listener: () => void) => {
    const listeners = visibleListeners.current
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  const getVisible = useCallback(() => visibleRef.current, [])
  const scroller = useRef<HTMLDivElement>(null)
  const notificationCount = useRef(0)
  // A scroll that has to wait until the table is drawn (first load, other zoom, weekends shown or folded).
  const pendingScroll = useRef<{ iso: string; smooth: boolean } | null>({ iso: opening, smooth: false })
  // The first day next to the names, as last scrolled to or by: kept there when the table changes its size.
  const pinned = useRef(opening)
  const [foldWeekends, setFoldWeekends] = useState(loadFoldWeekends)
  // Bigger or smaller, like the zoom of the browser, for the plan only; kept for the next visit.
  const [scale, setScale] = useState(loadScale)
  const changeScale = (next: number) => {
    setScale(next)
    try {
      localStorage.setItem(SCALE_KEY, String(next))
    } catch {
      // Without storage the size holds until the page is left.
    }
  }
  const [perspective, setPerspective] = useState<Perspective>(loadPerspective)
  // The phase from the menu: the employees who work in it, and its sites and activities. Who does no offer
  // work does not see the offer phase (the server leaves it out of the plan, too).
  const phase: Phase = plan?.offerPhase === false ? 'Bauphase' : chosenPhase
  const [siteDay, setSiteDay] = useState<{ siteId: number; date: string } | null>(null)
  const [hidden, setHidden] = useState<number[]>(loadHidden)
  // The day open in the editor; addActivity: an activity dropped on it, added as a new row.
  // addHalf: a click on the free half of a day, added as a new row with its times.
  // fillFree: a click on "verfügbar": its row gets a site to choose.
  const [open, setOpen] = useState<{
    employee: PlanEmployee
    date: string
    addActivity?: Activity
    addHalf?: { start: string; end: string }
    fillFree?: boolean
  } | null>(null)
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
  // A change made elsewhere (the standard flow entered on the page of a site) can be taken back here, too.
  const [history, setHistory] = useState<{ undo: Step[]; redo: Step[] }>(() => {
    const handed = handedUndo()
    return { undo: handed ? [handed] : [], redo: [] }
  })
  useEffect(forgetHandedUndo, [])
  // A Baubeginn just entered: asked whether the standard flow goes into the plan.
  const [flowSite, setFlowSite] = useState<Site | null>(null)
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

  // The way back is used once; opening the plan anew starts at today again.
  useEffect(() => {
    try {
      sessionStorage.removeItem(RETURN_KEY)
    } catch {
      // Without storage the plan simply starts at today.
    }
  }, [])

  const closeCellMenu = useCallback(() => setCellMenu(null), [])
  // Notes in the fields of the employees: the menu of a right click on one, and the note being written.
  const [noteMenu, setNoteMenu] = useState<{ note: CalendarNote; x: number; y: number } | null>(null)
  const closeNoteMenu = useCallback(() => setNoteMenu(null), [])
  // A note opened to read, by those who may not change it.
  const [noteRead, setNoteRead] = useState<CalendarNote | null>(null)
  const [noteDialog, setNoteDialog] = useState<{ employee: { id: number; name: string }; date: string; note?: CalendarNote } | null>(null)
  const notesByCell = useMemo(() => {
    const result = new Map<string, CalendarNote[]>()
    for (const note of plan?.notes ?? []) {
      const key = cellKey(note.employeeId, note.date)
      result.set(key, [...(result.get(key) ?? []), note])
    }
    return result
  }, [plan])
  const employeeOfNote = (note: CalendarNote) => ({
    id: note.employeeId,
    name: [...(plan?.employees ?? []), ...(plan?.planners ?? [])].find((employee) => employee.id === note.employeeId)?.name ?? '',
  })
  const keepNote = (note: CalendarNote) =>
    setPlan((current) =>
      current && {
        ...current,
        notes: [...(current.notes ?? []).filter((other) => other.id !== note.id), note].sort(
          (a, b) => a.date.localeCompare(b.date) || a.id - b.id,
        ),
      },
    )
  const dropNote = (id: number) =>
    setPlan((current) => current && { ...current, notes: (current.notes ?? []).filter((note) => note.id !== id) })
  const noteProps = {
    notesOf: (employeeId: number, date: string) => notesByCell.get(cellKey(employeeId, date)) ?? [],
    onNoteMenu: canEdit ? (note: CalendarNote, at: { x: number; y: number }) => setNoteMenu({ note, ...at }) : undefined,
    // A tap on a note opens it: to change it, or else to read it.
    onOpenNote: (note: CalendarNote) =>
      canEdit ? setNoteDialog({ employee: employeeOfNote(note), date: note.date, note }) : setNoteRead(note),
  }

  // The logo, with this plan as the start: to today.
  useWindowEvent(HOME_EVENT, () => goToday())

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


  const siteById = useMemo(() => new Map((plan?.sites ?? []).map((site) => [site.id, site])), [plan])

  // The search: the site looked for, its days in this plan (this year and phase), and its entries marked.
  const [handedFound] = useState(loadFound)
  const [foundId, setFoundId] = useState<number | null>(handedFound?.siteId ?? null)
  const revealOnLoad = useRef(handedFound?.day ?? null)
  const siteDays = useMemo(() => {
    const map = new Map<number, { days: string[]; ids: Set<number> }>()
    for (const entry of plan?.entries ?? []) {
      const site = entry.siteId === null ? undefined : siteById.get(entry.siteId)
      if (!site || entry.type !== 'Baustelle' || site.status === 'Storniert' || !inPhase(entry, site, phase)) continue
      const found = map.get(site.id) ?? { days: [], ids: new Set<number>() }
      if (!found.days.includes(entry.date)) found.days.push(entry.date)
      found.ids.add(entry.id)
      map.set(site.id, found)
    }
    for (const found of map.values()) found.days.sort()
    return map
  }, [plan, siteById, phase])
  const foundSite = foundId === null ? null : (siteById.get(foundId) ?? null)
  const foundIds = foundId === null ? undefined : siteDays.get(foundId)?.ids

  /** Brings the first entry of the found site on this day into view, up or down (the day is in view already). */
  const revealFound = (siteId: number, day: string) =>
    window.setTimeout(() => {
      const ids = siteDays.get(siteId)?.ids ?? new Set<number>()
      const entry = plan?.entries.find((candidate) => candidate.date === day && ids.has(candidate.id))
      const chip = entry && scroller.current?.querySelector<HTMLElement>(`[data-entry-id="${entry.id}"]`)
      chip?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' })
    }, 500)

  // A site found in another year: its plan opens at the day (see openInYear), here it comes into view.
  useEffect(() => {
    if (!plan || plan.year !== year || foundId === null || !revealOnLoad.current) return
    revealFound(foundId, revealOnLoad.current)
    revealOnLoad.current = null
  })
  const yearDays = useMemo(() => daysOfYear(year), [year])

  // The plan by site: every site of the phase with entries of the shown employees, planned in this year, or
  // open with activities still to plan; in the order the work starts there.
  // The activities each open site still needs in its status: not marked as not needed and not planned yet
  // (counted over all entries, whoever is shown).

  // Everybody who can be planned: the columns of the plan and the planners otherwise not shown.
  const everyone = useMemo(() => [...(plan?.employees ?? []), ...(plan?.planners ?? [])], [plan])
  // Only who works in the phase (see worksInPhase); the planners not shown otherwise only in the offer phase.
  const phaseEmployees = useMemo(
    () => (phase === 'Angebot' ? everyone : (plan?.employees ?? [])).filter((employee) => worksInPhase(employee, phase)),
    [plan, everyone, phase],
  )

  const siteRows = useMemo<SiteRow[]>(() => {
    if (!plan) return []
    // By site everybody is shown: the choice of the employees is for the plan by employee only.
    const shown = new Set(phaseEmployees.map((e) => e.id))
    const rows = new Map<number, SiteRow & { start: string }>()
    for (const site of plan.sites) {
      // The construction phase shows the done sites as well; cancelled ones nowhere.
      if (site.status !== phase && !(phase === 'Bauphase' && site.status === 'Abgeschlossen')) continue
      // On a phone the done sites stay out; service calls are no sites to follow.
      if ((isPhone && site.status === 'Abgeschlossen') || site.isService) continue
      const plannedThisYear =
        site.plannedStart && site.plannedStart <= `${year}-12-31` && (site.plannedEnd ?? site.plannedStart) >= `${year}-01-01`
      // Planned for this year, or without a Baubeginn yet (those go last).
      if (plannedThisYear || !site.plannedStart) rows.set(site.id, { site, byDate: new Map(), start: site.plannedStart ?? '9999-12-31' })
    }
    for (const entry of plan.entries) {
      if (entry.siteId === null || !shown.has(entry.employeeId)) continue
      const site = siteById.get(entry.siteId)
      if (!site || site.status === 'Storniert' || !inPhase(entry, site, phase)) continue
      if ((isPhone && site.status === 'Abgeschlossen') || site.isService) continue
      const row = rows.get(site.id) ?? { site, byDate: new Map(), start: entry.date }
      if (entry.date < row.start) row.start = entry.date
      const list = row.byDate.get(entry.date)
      if (list) list.push(entry)
      else row.byDate.set(entry.date, [entry])
      rows.set(site.id, row)
    }
    // On a phone in the order of the alphabet; otherwise by Baubeginn, the sites without one at the end.
    const begin = (row: SiteRow) => row.site.plannedStart ?? '9999-12-31'
    return [...rows.values()].sort((a, b) =>
      isPhone ? a.site.name.localeCompare(b.site.name, 'de') : begin(a).localeCompare(begin(b)) || a.site.name.localeCompare(b.site.name, 'de'),
    )
  }, [plan, phase, phaseEmployees, siteById, year, isPhone])

  // The sites of the shown week and the weeks around it, most used first: one tap instead of typing. Worked out
  // when sites are assigned, for the days in view then.
  const recentSites = () => {
    const from = addDays(weekOf(visibleRef.current.from)[0].iso, -7)
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
  }

  // On a phone always a week, with narrow weekends: there is no room for the switches.
  const view: View = isPhone ? 'week' : chosenView
  const weekendsFolded = isPhone || foldWeekends
  const inYear = (iso: string) => iso >= first && iso <= last
  const clamp = (iso: string) => (iso < first ? first : iso > last ? last : iso)

  const nameWidth = () => scroller.current?.querySelector<HTMLElement>('th.corner')?.offsetWidth ?? 0
  // Where a column starts within the scrolled plan (offsetLeft would count from a box further out).
  const leftOf = (column: HTMLElement) => {
    const element = scroller.current!
    return column.getBoundingClientRect().left - element.getBoundingClientRect().left - element.clientLeft + element.scrollLeft
  }

  // Where the day columns are, measured once after each drawing (and when the table changes its size): measuring
  // all 365 of them at every frame of a move made wiping on a phone stutter.
  const columns = useRef<{ iso: string; start: number; width: number }[] | null>(null)
  useLayoutEffect(() => {
    columns.current = null
  })

  /** The days between the employee names and the right edge, read from the drawn columns. */
  const readVisible = () => {
    const element = scroller.current
    if (!element) return null
    if (!columns.current) {
      const measured = []
      for (const column of element.querySelectorAll<HTMLElement>('th.dayhead')) {
        if (column.offsetWidth === 0) return null
        measured.push({ iso: column.id.slice(4), start: leftOf(column), width: column.offsetWidth })
      }
      columns.current = measured
    }
    const left = element.scrollLeft + nameWidth()
    const right = element.scrollLeft + element.clientWidth
    let from: string | null = null
    let to: string | null = null
    for (const { iso, start, width } of columns.current) {
      if (!from && start + width > left + 1) from = iso
      if (start < right) to = iso
      else break
    }
    return from && to ? { from, to } : null
  }

  const scrollNow = (iso: string, smooth: boolean) => {
    // A phone shows the plan week by week: from the Monday on (if that is in the year). Today, on opening the
    // plan or with Heute, starts the view itself: what is past lies to the left.
    const monday = isPhone && view === 'week' && iso !== today ? weekOf(iso)[0].iso : iso
    const column = document.getElementById(`col-${monday}`) ?? document.getElementById(`col-${iso}`)
    if (!scroller.current || !column) return false
    pinned.current = column.id.slice(4)
    scroller.current.scrollTo?.({ left: leftOf(column) - nameWidth(), behavior: smooth ? 'smooth' : 'auto' })
    return true
  }

  /** Scrolls so that the given day is the first one next to the employee names. */
  const scrollToDate = (iso: string, smooth = false) => {
    const from = clamp(iso)
    const filled = liveRef.current
    // Beyond the days filled in (e.g. Heute after paging far): they are drawn first, then the plan goes straight
    // there, without gliding over empty days.
    const far = from < filled.from || addDays(from, 30) > filled.to
    setVisible({ from, to: clamp(addDays(from, view === 'week' ? 13 : 30)) }, far)
    if (far) {
      pendingScroll.current = { iso: from, smooth: false }
      return
    }
    if (!scrollNow(from, smooth)) pendingScroll.current = { iso: from, smooth }
  }

  // Scrolling (wiping on a phone) draws nothing anew: the days in view are read at most once a frame.
  const frame = useRef(0)
  const onScroll = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const next = readVisible()
      if (!next) return
      pinned.current = next.from
      setVisible(next)
    })
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

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
      columns.current = null
      const column = document.getElementById(`col-${pinned.current}`)
      const corner = element.querySelector<HTMLElement>('th.corner')
      if (!column || pendingScroll.current) return
      const start = column.getBoundingClientRect().left - element.getBoundingClientRect().left - element.clientLeft + element.scrollLeft
      const left = start - (corner?.offsetWidth ?? 0)
      if (Math.abs(element.scrollLeft - left) > 1) element.scrollLeft = left
    }
    const observer = new ResizeObserver(keep)
    for (const child of element.querySelectorAll('table, th.corner')) observer.observe(child)
    return () => observer.disconnect()
  }, [plan, perspective, view, weekendsFolded])

  // Another phase from the menu: what was selected or marked belongs to the other one.
  const [shownPhase, setShownPhase] = useState(phase)
  if (shownPhase !== phase) {
    setShownPhase(phase)
    setSelected(new Set())
    setMarked(null)
  }

  const changePerspective = (next: Perspective) => {
    pendingScroll.current = { iso: visibleRef.current.from, smooth: false }
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
    pendingScroll.current = { iso: visibleRef.current.from, smooth: false }
    setChosenView(next)
  }

  const toggleWeekends = (fold: boolean) => {
    pendingScroll.current = { iso: visibleRef.current.from, smooth: false }
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
    const anchor = visibleRef.current.from
    const target = view === 'week' ? addDays(weekOf(anchor)[0].iso, 7 * direction) : addMonths(anchor, direction)
    if (onYearChange && direction === 1 && (target > last || visibleRef.current.to >= last)) {
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

  /** A day of the found site: the plan goes there and shows its entry. */
  const showFound = (siteId: number, day: string) => {
    scrollToDate(day, true)
    revealFound(siteId, day)
  }

  /**
   * A site searched for: its next day in this plan, else (no day this year) the plan of the year with its
   * next day, else the last one it had.
   */
  const findSite = async (site: Site | null) => {
    setFoundId(site?.id ?? null)
    if (!site) return
    const days = siteDays.get(site.id)?.days ?? []
    const day = days.find((d) => d >= today) ?? days.at(-1)
    if (day) {
      showFound(site.id, day)
      return
    }
    try {
      const all = [...new Set((await api.siteReport(site.id)).entries.map((entry) => entry.date))].sort()
      const other = all.find((d) => d >= today) ?? all.at(-1)
      if (!other || Number(other.slice(0, 4)) === year) {
        notifications.show({ message: `${site.name}: in diesem Jahr ist hier nichts eingeplant.`, autoClose: 4000 })
        return
      }
      if (!onYearChange) return
      notifications.show({ message: `${site.name}: Einsätze im Jahr ${other.slice(0, 4)}, der Plan wechselt dorthin.`, autoClose: 4000 })
      try {
        sessionStorage.setItem(FOUND_KEY, JSON.stringify({ siteId: site.id, day: other }))
      } catch {
        // Without storage the other year opens at the day, without the search.
      }
      openInYear(other)
    } catch (e) {
      notifications.show({ color: 'red', message: messageOf(e) })
    }
  }

  const search = (
    <PlanSearch
      sites={plan?.sites ?? []}
      daysOf={(siteId) => siteDays.get(siteId)?.days ?? []}
      today={today}
      year={year}
      found={foundSite}
      onFind={(site) => void findSite(site)}
      onGo={(day) => foundId !== null && showFound(foundId, day)}
    />
  )

  if (error) return <p className="error page">{error}</p>
  if (!plan || plan.year !== year) return null

  const entriesOf = (employeeId: number, date: string) => entriesByCell.get(cellKey(employeeId, date)) ?? []
  // Work of the other phase stays visible, but pale: the day is not free.
  // "verfügbar" belongs to every phase: always in full colour.
  const siteOf = (entry: Entry) => (entry.siteId === null ? undefined : siteById.get(entry.siteId))
  // Reserved days of offer sites without Baubeginn: framed in black on white.
  const isReserved = (entry: Entry) => phase === 'Bauphase' && isReservation(entry, siteOf(entry))
  const isDimmed = (entry: Entry) =>
    entry.type === 'Baustelle' && !isFree(entry) && !inPhase(entry, entry.siteId === null ? undefined : siteById.get(entry.siteId), phase)
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

  const applyToSelection = async (
    build: (employeeId: number, date: string) => DayEntryInput[],
    message: string,
    /** Days of the selection to leave as they are. */
    skip: (date: string) => boolean = () => false,
  ) => {
    const changes = [...selected].map(parseKey).filter(({ date }) => !skip(date)).map(({ employeeId, date }) => ({
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

  const title = <PlanTitle subscribe={subscribeVisible} getVisible={getVisible} view={view} year={year} />

  /** Puts these employees on a site on that day, each with their own activity there, next to what they have. */
  const addToSite = async (site: Site, employeeIds: number[], date: string) => {
    const changes = employeeIds.map((employeeId) => {
      const employee = everyone.find((candidate) => candidate.id === employeeId)!
      return {
        employeeId,
        date,
        entries: [
          ...entriesOf(employeeId, date).map(toInput),
          onDay(
            {
              type: 'Baustelle' as const,
              siteId: site.id,
              activity: defaultActivity(employee, site.status),
              startTime: null,
              endTime: null,
              note: null,
              noteImportant: false,
            },
            entriesOf(employeeId, date),
          ),
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
   * Entered into several fields at once, weekends and public holidays stay free; unless only such days are
   * marked, on purpose.
   */
  const keepsFree = () => selected.size > 1 && [...selected].some((key) => isWorkday(parseKey(key).date))

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
   * The entry copied into a day of an employee: what is there at the same time is overwritten (a whole day
   * overwrites all sites of the day, half a day the same half), the rest stays. A day with Urlaub or Krank, or
   * with this very entry already, is left as it is (null).
   */
  const fillDay = (entry: Entry, employeeId: number, iso: string): DayEntryInput[] | null => {
    const there = entriesOf(employeeId, iso)
    if (there.some((other) => other.type !== 'Baustelle')) return null
    if (there.some((other) => other.siteId === entry.siteId && other.activity === entry.activity && other.startTime === entry.startTime)) return null
    const span = (e: { startTime: string | null; endTime: string | null }) => [e.startTime ?? '00:00', e.endTime ?? '24:00']
    const [start, end] = span(entry)
    const kept = there.filter((other) => {
      const [otherStart, otherEnd] = span(other)
      return !(start < otherEnd && otherStart < end)
    })
    return [...kept.map(toInput), onDay({ ...toInput(entry), note: null, noteImportant: false }, kept)]
  }

  /**
   * A stretch dragged to new first and last days: working days that come in get the same site, activity and
   * time (not the note), overwriting what is there at that time (see fillDay); days that drop out lose the entry.
   */
  const restretch = async (entry: Entry, from: string, to: string) => {
    const current = stretchOf(entry)
    const changes: DayChange[] = []
    for (let iso = from; iso <= to; iso = addDays(iso, 1)) {
      if ((iso >= current.from && iso <= current.to) || !isWorkday(iso)) continue
      const entries = fillDay(entry, entry.employeeId, iso)
      if (entries) changes.push({ employeeId: entry.employeeId, date: iso, entries })
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

  /**
   * The marked stretch dragged down (or up) over other employees: the same days, site, activity and time for
   * them, overwriting what they have at that time (see fillDay).
   */
  const fillDown = async (entry: Entry, rows: string[]) => {
    const current = stretchOf(entry)
    const employeeIds = rows.map((row) => Number(row.slice(1)))
    const changes: DayChange[] = []
    for (const employeeId of employeeIds)
      for (let iso = current.from; iso <= current.to; iso = addDays(iso, 1)) {
        if (!entriesOf(entry.employeeId, iso).some((other) => current.ids.has(other.id))) continue
        const entries = fillDay(entry, employeeId, iso)
        if (entries) changes.push({ employeeId, date: iso, entries })
      }
    if (changes.length === 0) return
    const people = employeeIds.length === 1 ? (everyone.find((e) => e.id === employeeIds[0])?.name ?? '1 Mitarbeiter') : `${employeeIds.length} Mitarbeiter`
    await save(changes, `${entryName(entry)}: übernommen für ${people}.`)
  }

  /** Adds the clipboard to these cells (see pasteChanges); cut entries leave their day in the same step. */
  const paste = async (targets: PasteTarget[]) => {
    if (!clip) return
    // Copied Urlaub or Krank stays away for Planer A; the rest is pasted.
    const absence = clip.entries.find((entry) => entry.type !== 'Baustelle')
    if (absence && !canAbsence) absenceHint(absence.type as AbsenceType)
    const entries = canAbsence ? clip.entries : clip.entries.filter((entry) => entry.type === 'Baustelle')
    const message = `${clip.label} in ${targets.length} ${targets.length === 1 ? 'Feld' : 'Felder'} eingefügt.`
    if (entries.length > 0) await save(pasteChanges({ ...clip, entries }, targets, entriesOf, everyone, siteById, isWorkday), message)
    // The notes go into the fields of the employees (not onto a site).
    const notes = clip.notes ?? []
    for (const target of targets)
      for (const note of notes)
        if (target.employeeId !== undefined)
          keepNote(await api.createNote({ employeeId: target.employeeId, date: target.date, title: note.title, text: note.text ?? '' }))
    if (clip.cut)
      for (const note of notes) {
        await api.deleteNote(note.id)
        dropNote(note.id)
      }
    if (clip.entries.length === 0 && notes.length > 0) notifications.show({ message, color: 'green' })
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

  /** Planer A may not enter Urlaub and Krank: they are told who does. */
  const absenceHint = (type: AbsenceType) =>
    notifications.show({
      color: 'orange',
      message:
        type === 'Urlaub'
          ? 'Urlaub wird nur seitens der Geschäftsleitung im Kalender eingetragen.'
          : 'Krankheitstage werden nur seitens der Geschäftsleitung im Kalender eingetragen.',
      autoClose: 5000,
    })

  /** A click on Urlaub / Krank above the plan: into the selected fields, else how to use it. */
  const markAbsence = (type: AbsenceType) => {
    if (!canAbsence) {
      absenceHint(type)
      return
    }
    if (selected.size === 0) {
      notifications.show({ message: `${type} auf einen Tag ziehen, oder zuerst Felder auswählen.`, autoClose: 3000 })
      return
    }
    // Vacation over several days leaves out weekends and public holidays; one day alone is what was meant.
    const skip = (date: string) => type === 'Urlaub' && keepsFree() && !isWorkday(date)
    const days = [...selected].map(parseKey).filter(({ date }) => !skip(date)).length
    applyToSelection(() => absenceDay(type), absenceMessage(type, days), skip)
  }

  /** Dragging an end of the marked stretch along its row: the employee's row ('e') or the site's row ('s'). */
  const onStretchStart = (rows: 'e' | 's') =>
    canEdit && markedStretch
      ? (entry: Entry, side: 'left' | 'right' | 'down', event: PointerEvent) =>
          startStretch(
            {
              row: rows === 'e' ? `e${entry.employeeId}` : `s${entry.siteId}`,
              from: markedStretch.from,
              to: markedStretch.to,
              side,
              done: (from, to, others) => {
                ;(side === 'down' ? fillDown(entry, others) : restretch(entry, from, to)).catch(fail)
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
  /** Two entries of a day change places, with their times: the one above goes below. */
  const swapEntries = (a: Entry, b: Entry) => {
    const day = entriesOf(a.employeeId, a.date)
    const inputs = day.map(toInput)
    const ia = day.findIndex((entry) => entry.id === a.id)
    const ib = day.findIndex((entry) => entry.id === b.id)
    const swapped = inputs.map((input, i) =>
      i === ia
        ? { ...inputs[ib], startTime: input.startTime, endTime: input.endTime }
        : i === ib
          ? { ...inputs[ia], startTime: input.startTime, endTime: input.endTime }
          : input,
    )
    save([{ employeeId: a.employeeId, date: a.date, entries: swapped }], `${a.employeeName}: Reihenfolge getauscht.`).catch(fail)
  }

  /** Half a day on a site moves to the other, free half of the day: morning and afternoon change. */
  const dropOnFree = (entry: Entry) =>
    dropTarget(
      (item: DragItem) => item.kind === 'entry' && item.entry.id === entry.id,
      () => {
        const [morning, afternoon] = HALF_DAYS
        const half = (entry.startTime ?? '') >= '12:00' ? morning : afternoon
        const entries = entriesOf(entry.employeeId, entry.date).map((other) =>
          other.id === entry.id ? { ...toInput(other), startTime: `${half.start}:00`, endTime: `${half.end}:00` } : toInput(other),
        )
        save(
          [{ employeeId: entry.employeeId, date: entry.date, entries }],
          `${entry.employeeName}: ${entryName(entry)} jetzt ${half === morning ? 'vormittags' : 'nachmittags'}.`,
        ).catch(fail)
      },
      canEdit,
    )

  const dropOnEntry = (entry: Entry) =>
    dropTarget(
      (item: DragItem) => {
        // Another entry of the same day dragged onto this one: the two change places.
        if (item.kind === 'entry')
          return item.entry.id !== entry.id && item.entry.employeeId === entry.employeeId && item.entry.date === entry.date
        if (item.kind !== 'activity' || entry.type !== 'Baustelle' || item.activity === entry.activity) return false
        // A reserved day takes the activity only to say that the Baubeginn comes first.
        if (isReserved(entry)) return true
        const employee = everyone.find((candidate) => candidate.id === entry.employeeId)
        const site = entry.siteId === null ? undefined : siteById.get(entry.siteId)
        // An offer site with its Baubeginn entered is planned as a construction already.
        const status = site && isOpen(site.status) ? (site.status === 'Angebot' && site.plannedStart && phase === 'Bauphase' ? 'Bauphase' : site.status) : undefined
        return employee !== undefined && canDo(employee, item.activity, status)
      },
      (item: DragItem) => {
        if (item.kind === 'entry') return swapEntries(item.entry, entry)
        if (item.kind !== 'activity') return
        if (isReserved(entry)) {
          notifications.show({
            color: 'orange',
            message: `${entry.siteName}: erst den Baubeginn eintragen, dann bekommt die Baustelle ihre Tätigkeiten.`,
          })
          return
        }
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
    // A new site with its Baubeginn (e.g. Abriss dragged in): asked about the standard flow once the day is saved.
    if (canEdit && site.plannedStart && !site.isService) setFlowSite(site)
    setPlan((current) =>
      current && { ...current, sites: [...current.sites, site].sort((a, b) => a.name.localeCompare(b.name, 'de')) },
    )
    return site
  }

  /** Saves a site and shows its new name in all cells at once. */
  const updateSite = async (id: number, input: SiteInput) => {
    const before = siteById.get(id)
    const site = await api.updateSite(id, input)
    if (canEdit && site.plannedStart && !before?.plannedStart && !site.isService) setFlowSite(site)
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
          sessionStorage.setItem(RETURN_KEY, visibleRef.current.from)
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
  const perspectiveSwitch = (
    <SegmentedControl
      size={isPhone ? 'xs' : 'sm'}
      value={perspective}
      onChange={(value) => changePerspective(value as Perspective)}
      data={[
        { value: 'employees', label: 'Nach Mitarbeiter' },
        { value: 'sites', label: 'Nach Baustelle' },
      ]}
      color="wego"
    />
  )
  /** The choice of the employees shown, opened by the button given. */
  const employeeMenu = (target: ReactNode) => (
    <Menu closeOnItemClick={false} position="bottom-start" withinPortal>
      <Menu.Target>{target}</Menu.Target>
      <Menu.Dropdown>
        <Group gap={4} px="xs" py={4}>
          <Button size="compact-xs" variant="subtle" onClick={() => storeHidden([])}>
            Alle auswählen
          </Button>
          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => storeHidden(everyone.map((employee) => employee.id))}>
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
  )
  // The corner of the plan opens the choice of the employees; by site it is not needed.
  const corner = perspective === 'sites' ? 'Baustelle' : employeeMenu(
    <UnstyledButton className="corner-menu" aria-label={`Mitarbeiter auswählen (${employees.length}/${phaseEmployees.length})`}>
      Name
      <span className="corner-count">
        {employees.length}/{phaseEmployees.length} ▾
      </span>
    </UnstyledButton>,
  )

  // First names, as in the plan.
  const paletteNames = shortNames(phaseEmployees)

  // All entries of the marked fields, over several days and employees: copied together, they keep their days.
  const selectedEntries = [...selected].map(parseKey).flatMap(({ employeeId, date }) => entriesOf(employeeId, date))
  const copySelection = (cut: boolean) => {
    copyEntries(selectedEntries, cut)
    notifications.show({
      message: `${cut ? 'Ausgeschnitten' : 'Kopiert'}: ${selected.size} ${selected.size === 1 ? 'Feld' : 'Felder'}. Das erste Feld wählen, in das eingefügt wird, und „Einfügen“.`,
      autoClose: 4000,
    })
    setSelected(new Set())
  }

  return (
    <div className="plan">
      <div className="plan-toolbar">
        <Group gap="xs" wrap="wrap" className="plan-controls">
          {/* On a phone: view and year in one row, the arrows and "Heute" centred below. The choice of the
              employees sits in the corner of the plan. */}
          {isPhone ? (
            <Group gap={6} wrap="nowrap" justify="space-between" w="100%">
              {perspectiveSwitch}
              <YearSelect year={year} onChange={onYearChange} small />
            </Group>
          ) : (
            perspectiveSwitch
          )}
          {/* Zoom, paging and the shown weeks at the right, before the switches. On a phone only ‹ Heute ›. */}
          {isPhone ? (
            <Group gap={6} wrap="nowrap" justify="center" w="100%" className="phone-paging">
              <ActionIcon variant="default" size="input-sm" onClick={() => step(-1)} aria-label="Zurück">
                ‹
              </ActionIcon>
              <Button size="sm" color="wegoRed.6" onClick={goToday}>
                Heute
              </Button>
              <ActionIcon variant="default" size="input-sm" onClick={() => step(1)} aria-label="Weiter">
                ›
              </ActionIcon>
            </Group>
          ) : (
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
              <YearSelect year={year} onChange={onYearChange} />
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
              <Switch
                size="sm"
                label="Wochenenden ausblenden"
                checked={foldWeekends}
                onChange={(event) => toggleWeekends(event.currentTarget.checked)}
              />
              <Group gap={2} wrap="nowrap" className="plan-scale">
                <ActionIcon
                  variant="default"
                  size="input-sm"
                  aria-label="Kleiner"
                  disabled={scale === SCALES[0]}
                  onClick={() => changeScale(SCALES[SCALES.indexOf(scale) - 1])}
                >
                  −
                </ActionIcon>
                <Tooltip label="Zurück auf 100 %">
                  <UnstyledButton className="plan-scale-value" aria-label={`Größe ${scale} %`} onClick={() => changeScale(100)}>
                    {scale} %
                  </UnstyledButton>
                </Tooltip>
                <ActionIcon
                  variant="default"
                  size="input-sm"
                  aria-label="Größer"
                  disabled={scale === SCALES.at(-1)}
                  onClick={() => changeScale(SCALES[SCALES.indexOf(scale) + 1])}
                >
                  +
                </ActionIcon>
              </Group>
            </Group>
          )}
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
          {/* The activities go onto an employee's day (the site is chosen or created there), or onto an entry to
              change what the employee does there; a phone cannot drag them, so they stay away there. */}
          {!isPhone && <PhaseActivities phase={phase} draggable={canEdit} />}
          {/* The search in the middle, between the activities and Urlaub / Krank. */}
          <div className="plan-search">{search}</div>
          {canEdit && perspective === 'employees' && (
            <span className="flow-steps absence-steps" role="group" aria-label="Abwesenheit eintragen">
              {(['Urlaub', 'Krank'] as const).map((type) => (
                <Tooltip
                  key={type}
                  label={
                    canAbsence
                      ? `Auf einen Tag eines Mitarbeiters ziehen, oder Felder auswählen und hier klicken: ${type}`
                      : `${type} trägt nur die Geschäftsleitung ein.`
                  }
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
                    {...dragSource({ kind: 'absence', type }, !isPhone && canAbsence)}
                  >
                    {type === 'Urlaub' && <ActivityIcon type={type} size={11} />}
                    {type}
                  </button>
                </Tooltip>
              ))}
            </span>
          )}
        </div>
        {canEdit && perspective === 'sites' && !isPhone && phaseEmployees.length > 0 && (
          <div className="employee-palette" role="group" aria-label="Mitarbeiter zum Einplanen">
            <Text size="xs" c="dimmed">
              Auf eine Baustelle ziehen:
            </Text>
            {phaseEmployees.map((employee) => {
              return (
                <span
                  key={employee.id}
                  className="palette-employee drag-source"
                  title={`${employee.name} auf einen Tag einer Baustelle ziehen`}
                  {...dragSource({ kind: 'employee', employeeId: employee.id, name: employee.name }, true)}
                >
                  {paletteNames.get(employee.id) ?? employee.name}
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
        style={scale === 100 ? undefined : { zoom: scale / 100 }}
        ref={scroller}
        onScroll={onScroll}
        // Strg+C / Strg+X: the marked entry, else the whole field clicked last (with its notes);
        // Strg+V: into the selected fields, else into the field clicked last.
        onKeyDown={(event) => {
          if (!canEdit || !(event.ctrlKey || event.metaKey)) return
          const key = event.key.toLowerCase()
          const focused = (event.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell
          if (key === 'c' || key === 'x') {
            const field = focused ? parseKey(focused) : null
            const entries = markedEntry ? [markedEntry] : field ? entriesOf(field.employeeId, field.date) : []
            const notes = !markedEntry && field ? (notesByCell.get(focused!) ?? []) : []
            if (entries.length === 0 && notes.length === 0) return
            event.preventDefault()
            copyEntries(entries, key === 'x', notes)
            notifications.show({ message: key === 'x' ? 'Ausgeschnitten.' : 'Kopiert.', autoClose: 2000 })
          } else if (key === 'v' && clip && (selected.size > 0 || focused)) {
            event.preventDefault()
            paste(toTargets(selected.size > 0 ? [...selected] : [focused!])).catch(fail)
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
            foldWeekends={weekendsFolded}
            dropOn={canEdit ? dropOnEmployee : undefined}
            dropOnEntry={canEdit ? dropOnEntry : undefined}
            dropOnFree={canEdit ? dropOnFree : undefined}
            onOpenFree={canEdit ? (employee, date, half) => setOpen({ employee, date, addHalf: half }) : undefined}
            onFillFree={canEdit ? (employee, date) => setOpen({ employee, date, fillFree: true }) : undefined}
            onCellMenu={canEdit ? (employee, date, { x, y, entryId }) => setCellMenu({ employee, date, x, y, entryId }) : undefined}
            marked={markedStretch && { ids: markedStretch.ids, first: markedStretch.first.id, last: markedStretch.last.id }}
            found={foundIds}
            live={live}
            onMark={canEdit ? (entry) => setMarked(entry?.id ?? null) : undefined}
            onStretchStart={onStretchStart('e')}
            corner={corner}
            isReserved={isReserved}
            {...shared}
            {...noteProps}
          />
        ) : (
          <SiteTimeline
            corner={corner}
            isReserved={isReserved}
            days={yearDays}
            rows={siteRows}
            holidayByDate={holidayByDate}
            today={today}
            zoom={view}
            foldWeekends={weekendsFolded}
            onOpenCell={(site, date) => setSiteDay({ siteId: site.id, date })}
            onOpenSite={shared.onOpenSite}
            dropOn={canEdit ? dropOnSite : undefined}
            dropOnEntry={canEdit ? dropOnEntry : undefined}
            onCellMenu={canEdit ? (site, date, { x, y, entryId }) => setCellMenu({ site, date, x, y, entryId }) : undefined}
            marked={markedStretch && { ids: markedStretch.ids, first: markedStretch.first.id, last: markedStretch.last.id }}
            found={foundIds}
            live={live}
            onMark={canEdit ? (entry) => setMarked(entry?.id ?? null) : undefined}
            onStretchStart={onStretchStart('s')}
          />
        )}
      </div>

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
              {selectedEntries.length > 0 && (
                <>
                  <Button size="xs" variant="default" onClick={() => copySelection(false)}>
                    Kopieren
                  </Button>
                  <Button size="xs" variant="default" onClick={() => copySelection(true)}>
                    Ausschneiden
                  </Button>
                </>
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
          recentSites={recentSites()}
          phase={phase}
          onClose={() => setAssigning(false)}
          onApply={async (template, add, choice) => {
            // A site over several days (over a weekend): weekends and public holidays stay free.
            const free = keepsFree()
            const changes = [...selected].map(parseKey).filter(({ date }) => !free || isWorkday(date)).map(({ employeeId, date }) => {
              // Everybody gets the chosen activity if they can do it, else the first one they can do.
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
            addHalf={open.addHalf}
            fillFree={open.fillFree}
            phase={phase}
            entries={entriesOf(open.employee.id, open.date)}
            sites={plan.sites}
            onCreateSite={createSite}
            onGoToSite={canEdit ? shared.onOpenSite : undefined}
            canAbsence={canAbsence}
            onConfirm={async (site, asService) => {
              await api.confirmSite(site.id, asService)
              // Its days got their activities on the server: the plan anew.
              setPlan(await api.plan(year))
              setOpen(null)
              notifications.show({
                color: 'green',
                message: `${site.name.replace(/^\? /, '')}: bestätigt als ${asService ? 'Serviceauftrag' : 'Baustelle'}.`,
              })
            }}
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
              notes={employee ? (notesByCell.get(cellKey(employee.id, date)) ?? []) : []}
              extra={
                employee
                  ? [
                      // A field of a marking over several: the whole marking at once.
                      ...(selected.size > 1 && selected.has(cellKey(employee.id, date)) && selectedEntries.length > 0
                        ? [
                            { label: `Markierung kopieren (${selected.size} Felder)`, onClick: () => copySelection(false) },
                            { label: `Markierung ausschneiden (${selected.size} Felder)`, onClick: () => copySelection(true) },
                          ]
                        : []),
                      { label: 'Notiz einfügen', onClick: () => setNoteDialog({ employee, date }) },
                    ]
                  : []
              }
            />
          )
        })()}
      {noteMenu && (
        <CellMenu
          x={noteMenu.x}
          y={noteMenu.y}
          onClose={closeNoteMenu}
          items={[
            {
              label: `Notiz bearbeiten: ${noteMenu.note.title}`,
              onClick: () => setNoteDialog({ employee: employeeOfNote(noteMenu.note), date: noteMenu.note.date, note: noteMenu.note }),
            },
            {
              label: `Notiz kopieren: ${noteMenu.note.title}`,
              onClick: () => {
                copyEntries([], false, [noteMenu.note])
                notifications.show({ message: 'Notiz kopiert. Rechtsklick auf ein Feld und „Einfügen“.', autoClose: 3000 })
              },
            },
            {
              label: `Notiz löschen: ${noteMenu.note.title}`,
              onClick: () => {
                const { id } = noteMenu.note
                api.deleteNote(id).then(() => dropNote(id), fail)
              },
            },
          ]}
        />
      )}
      {noteRead && <NoteView note={noteRead} employeeName={employeeOfNote(noteRead).name} onClose={() => setNoteRead(null)} />}
      {noteDialog && (
        <NoteDialog
          employee={noteDialog.employee}
          date={noteDialog.date}
          note={noteDialog.note}
          onSaved={keepNote}
          onDeleted={dropNote}
          onClose={() => setNoteDialog(null)}
        />
      )}
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
      )}
      {flowSite && !open && (
        <StandardFlowDialog
          site={flowSite}
          onClose={() => setFlowSite(null)}
          onEntered={(step, saved) => {
            merge(step.after, saved)
            setHistory((current) => ({ undo: [...current.undo, step], redo: [] }))
          }}
        />
      )}
    </div>
  )
}
