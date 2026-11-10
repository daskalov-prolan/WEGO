import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import type { CalendarNote, Entry, NamedItem, PlanEmployee, SchoolHoliday, Site } from '../api/types'
import { CellNotes } from './CalendarNotes'
import type { Day } from '../lib/dates'
import { formatDateLong, HALF_DAYS, isoWeek, MONTHS } from '../lib/dates'
import { BirthdayIcon } from './BirthdayIcon'
import { serviceName, entryName, entryStyle, entryTitle, isFree, onlyHalfDay } from '../lib/activities'
import { cellKey } from '../lib/ui'
import { dragSource } from '../lib/dragPlan'
import { Chip, NoteMark } from './Chip'

/** Handlers that make a cell a place to drop entries and open activities on (see dropTarget). */
type DropHandlers = Record<string, unknown>

export interface MatrixProps {
  /** Who has a birthday: "MM-DD" to the names; a present in the head of the day. */
  birthdays?: Map<string, string[]>
  /** The notes in the field of an employee and a day. */
  notesOf?: (employeeId: number, date: string) => CalendarNote[]
  /** Planners: a right click on a note (change or delete it). */
  onNoteMenu?: (note: CalendarNote, at: { x: number; y: number }) => void
  /** Planners: a click on a note opens it to change it. */
  onOpenNote?: (note: CalendarNote) => void
  days: Day[]
  employees: PlanEmployee[]
  entriesOf: (employeeId: number, date: string) => Entry[]
  holidayByDate: Map<string, SchoolHoliday>
  today: string
  /** With a site filter: entries of other sites are dimmed. */
  isDimmed: (entry: Entry) => boolean
  /** Planners get links from the names into the employee report. */
  linkNames: boolean
  onOpen: (employee: PlanEmployee, date: string) => void
  /** Click on a site name in a cell: opens the record of that site. */
  onOpenSite: (siteId: number) => void
  /** Planners can select several cells: drag with the mouse, Ctrl+click, or long press on touch screens. */
  selectable: boolean
  selected: Set<string>
  onSelectedChange: (selected: Set<string>) => void
  /** How much of the timeline fits on the screen: about two weeks, or a month. */
  zoom: 'week' | 'month'
  /** Saturdays and Sundays as narrow strips (about 0.5 cm). */
  foldWeekends?: boolean
  /** Planners: entries and open activities can be dragged onto a cell of an employee and a day. */
  dropOn?: (employee: PlanEmployee, date: string) => DropHandlers
  /** Planners: an activity dragged onto an entry becomes its activity. */
  dropOnEntry?: (entry: Entry) => DropHandlers
  /** Planners: the entry of half a day dragged onto the free half ("verfügbar") moves there. */
  dropOnFree?: (entry: Entry) => DropHandlers
  /** Planners: a click on the free half ("verfügbar") plans a site in that half of the day. */
  onOpenFree?: (employee: PlanEmployee, date: string, half: { start: string; end: string }) => void
  /** false: no "verfügbar" for the free half of a day (the offer phase: planners are not booked by halves). */
  showsFree?: boolean
  /** Planners: a click on an entry kept free ("verfügbar") opens the day to put a site in its place. */
  onFillFree?: (employee: PlanEmployee, date: string) => void
  /** Planners: the marked entries (a stretch of days) and the entries at its ends. */
  marked?: { ids: Set<number>; first: number; last: number }
  /** The entries of the site searched for: highlighted. */
  found?: Set<number>
  /**
   * The days filled in: those around the ones in view. The others stay empty (the year is wide and a phone would
   * draw thousands of fields at every move); they fill as soon as they come near.
   */
  live?: { from: string; to: string }
  /** Planners, mouse: a click on an entry marks it (null: a click elsewhere in a cell). A double click opens the day. */
  onMark?: (entry: Entry | null) => void
  /** Planners: an end of the marked stretch is dragged. */
  onStretchStart?: (entry: Entry, side: 'left' | 'right' | 'down', event: PointerEvent) => void
  /** Planners: a right click on a cell opens a menu (copy, cut, paste) at the pointer. */
  onCellMenu?: (employee: PlanEmployee, date: string, at: { x: number; y: number; entryId?: number }) => void
  /** In place of the word in the corner, e.g. the choice of the employees on a phone. */
  corner?: ReactNode
  /** A reserved day of an offer site: framed in black on white. */
  isReserved?: (entry: Entry) => boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Mouse: press and drag over cells selects a rectangle, Ctrl/Cmd+click adds single cells, a plain click
 * opens the day. Touch: a long press starts the selection, then every tap adds or removes a cell.
 */
function useCellSelection(props: MatrixProps, days: Day[]) {
  const { employees, selectable, selected, onSelectedChange, onOpen } = props
  const drag = useRef<{ employee: number; day: number; moved: boolean } | null>(null)
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  const pointerType = useRef('mouse')
  const swallowClick = useRef(false)

  useEffect(() => {
    const end = () => {
      if (drag.current?.moved) swallowClick.current = true
      drag.current = null
    }
    window.addEventListener('pointerup', end)
    return () => window.removeEventListener('pointerup', end)
  }, [])

  const toggle = (key: string) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onSelectedChange(next)
  }

  const rectangle = (from: { employee: number; day: number }, to: { employee: number; day: number }) => {
    const keys = new Set<string>()
    for (let e = Math.min(from.employee, to.employee); e <= Math.max(from.employee, to.employee); e++) {
      for (let d = Math.min(from.day, to.day); d <= Math.max(from.day, to.day); d++) {
        keys.add(cellKey(employees[e].id, days[d].iso))
      }
    }
    return keys
  }

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }

  // A click on a site name is the end of a drag or part of a selection on touch screens: then it is the cell's.
  const siteClickBelongsToCell = () => swallowClick.current || (selectable && selected.size > 0 && pointerType.current !== 'mouse')

  const handlers = (employeeIndex: number, dayIndex: number) => {
    const employee = employees[employeeIndex]
    const day = days[dayIndex]
    const key = cellKey(employee.id, day.iso)

    return {
      onPointerDown: (event: PointerEvent) => {
        pointerType.current = event.pointerType
        if (!selectable) return
        if (event.pointerType === 'mouse') {
          if (event.button !== 0) return
          if (event.ctrlKey || event.metaKey) {
            toggle(key)
            swallowClick.current = true
            return
          }
          drag.current = { employee: employeeIndex, day: dayIndex, moved: false }
        } else {
          cancelPress()
          press.current = {
            x: event.clientX,
            y: event.clientY,
            timer: window.setTimeout(() => {
              press.current = null
              swallowClick.current = true
              toggle(key)
              navigator.vibrate?.(15)
            }, 450),
          }
        }
      },
      onPointerEnter: (event: PointerEvent) => {
        const start = drag.current
        if (!start || event.buttons !== 1) return
        if (start.employee === employeeIndex && start.day === dayIndex && !start.moved) return
        start.moved = true
        onSelectedChange(rectangle(start, { employee: employeeIndex, day: dayIndex }))
      },
      onPointerMove: (event: PointerEvent) => {
        const started = press.current
        if (started && Math.hypot(event.clientX - started.x, event.clientY - started.y) > 10) cancelPress()
      },
      onPointerUp: cancelPress,
      onPointerCancel: cancelPress,
      // An entry is dragged out of the cell: that is no selection.
      onDragStart: () => {
        drag.current = null
        cancelPress()
      },
      onContextMenu: (event: MouseEvent) => {
        if (selectable && pointerType.current !== 'mouse') {
          event.preventDefault()
          return
        }
        if (!props.onCellMenu) return
        event.preventDefault()
        // A right click on one entry of the cell is about that entry.
        const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-entry-id]')
        const entryId = chip ? Number(chip.dataset.entryId) : undefined
        props.onCellMenu(employee, day.iso, { x: event.clientX, y: event.clientY, entryId })
      },
      onClick: (event: MouseEvent) => {
        if (swallowClick.current) {
          swallowClick.current = false
          return
        }
        // While selecting on a touch screen every tap changes the selection.
        if (selectable && selected.size > 0 && pointerType.current !== 'mouse') {
          toggle(key)
          return
        }
        if (selected.size > 0) onSelectedChange(new Set())
        const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-entry-id]')
        const entry = chip && props.entriesOf(employee.id, day.iso).find((candidate) => candidate.id === Number(chip.dataset.entryId))
        // "verfügbar" clicked: the day opens with a site to choose in its place.
        if (entry && isFree(entry) && props.onFillFree) {
          props.onFillFree(employee, day.iso)
          return
        }
        // With the mouse a click marks an entry (or lifts the mark); the day opens on a double click.
        if (props.onMark && pointerType.current === 'mouse') {
          props.onMark(entry ?? null)
          return
        }
        onOpen(employee, day.iso)
      },
      onDoubleClick: () => {
        if (props.onMark && pointerType.current === 'mouse') onOpen(employee, day.iso)
      },
    }
  }

  return { handlers, siteClickBelongsToCell }
}

function EmployeeName({ employee, link, label = employee.name }: { employee: NamedItem; link: boolean; label?: string }) {
  return link ? <a href={`#/mitarbeiter/${employee.id}`}>{label}</a> : <>{label}</>
}

/**
 * The first names of the plan, so that the column stays narrow; two of the same first name get the first letter
 * of their last name ("Nikolay M."). What stands in brackets (a nickname) is left out.
 */
export function shortNames(employees: NamedItem[]): Map<number, string> {
  const parts = (name: string) => name.replace(/\(.*?\)/g, ' ').trim().split(/\s+/)
  const first = (name: string) => parts(name)[0] ?? name
  const count = new Map<string, number>()
  for (const employee of employees) count.set(first(employee.name), (count.get(first(employee.name)) ?? 0) + 1)
  return new Map(
    employees.map((employee) => {
      const [given, ...rest] = parts(employee.name)
      const last = rest.at(-1)
      return [employee.id, (count.get(given) ?? 0) > 1 && last ? `${given} ${last[0]}.` : given || employee.name]
    }),
  )
}

function dayClass(day: Day, holiday: SchoolHoliday | undefined, today: string) {
  return [
    day.isWeekend ? 'weekend' : '',
    holiday ? (holiday.kind === 'Feiertag' ? 'public-holiday' : holiday.kind === 'Betriebsferien' ? 'closure' : 'holiday') : '',
    day.iso === today ? 'today' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** The columns of the days, with their widths (drawn anew only for other days). */
const DayColumns = memo(function DayColumns({ days }: { days: Day[] }) {
  return (
    <colgroup>
      <col className="col-employee" />
      {days.map((day) => (
        <col key={day.iso} className={day.isWeekend ? 'col-day col-weekend' : 'col-day'} />
      ))}
    </colgroup>
  )
})

/** The months above the days. */
const MonthCells = memo(function MonthCells({ days }: { days: Day[] }) {
  const months: { month: number; count: number }[] = []
  for (const day of days) {
    if (months.at(-1)?.month === day.month) months[months.length - 1].count++
    else months.push({ month: day.month, count: 1 })
  }
  return (
    <>
      {months.map(({ month, count }) => (
        <th key={month} colSpan={count} className="month">
          <span>
            {MONTHS[month]} {days[0].iso.slice(0, 4)}
          </span>
        </th>
      ))}
    </>
  )
})

/** The heads of the days: weekday, date, holiday and the calendar week on Mondays. */
const DayHeads = memo(function DayHeads({
  days,
  holidayByDate,
  today,
  zoom,
  start,
  end,
  birthdays,
}: {
  days: Day[]
  holidayByDate: Map<string, SchoolHoliday>
  today: string
  zoom: 'week' | 'month'
  /** The days filled in (see liveSpan): the others are one empty head before and one after. */
  start: number
  end: number
  birthdays?: Map<string, string[]>
}) {
  return (
    <>
      {start > 0 && <th colSpan={start} className="live-gap" />}
      {days.slice(start, end).map((day) => {
        const holiday = holidayByDate.get(day.iso)
        const born = birthdays?.get(day.iso.slice(5))
        // "Mein Geburtstag" stands as it is; the others are named.
        const others = born?.filter((who) => who !== 'Mein Geburtstag') ?? []
        const birthdayLine = born
          ? [born.length > others.length ? 'Mein Geburtstag' : null, others.length ? `Geburtstag: ${others.join(', ')}` : null]
              .filter(Boolean)
              .join(' · ')
          : null
        return (
          <th
            key={day.iso}
            id={`col-${day.iso}`}
            // Every Monday names its calendar week (drawn by the style sheet).
            data-kw={day.weekday === 'Mo' ? `KW ${isoWeek(day.iso)}` : undefined}
            className={`dayhead ${dayClass(day, holiday, today)}${day.weekday === 'Mo' ? ' week-start' : ''}${born ? ' has-birthday' : ''}`}
            title={[holiday ? `${formatDateLong(day.iso)} – ${holiday.name}` : formatDateLong(day.iso), birthdayLine]
              .filter(Boolean)
              .join('\n')}
          >
            {/* A birthday: the present in the head of the day, not in the fields of the sites. */}
            {birthdayLine && (
              <span className="birthday-mark" role="img" aria-label={birthdayLine}>
                <BirthdayIcon />
              </span>
            )}
            <span className="wd">{day.weekday}</span>
            <span className="num">
              {zoom === 'week' ? ` ${pad(day.dayOfMonth)}.${pad(day.month + 1)}` : day.dayOfMonth}
            </span>
          </th>
        )
      })}
      {end < days.length && <th colSpan={days.length - end} className="live-gap" />}
    </>
  )
})

interface FrameProps {
  days: Day[]
  holidayByDate: Map<string, SchoolHoliday>
  today: string
  zoom: 'week' | 'month'
  foldWeekends?: boolean
  /** Heading of the column on the left: "Mitarbeiter" or "Baustelle". */
  corner: ReactNode
  /** Rows of employees (first names only): a narrower column on the left. */
  byEmployee?: boolean
  /** The days filled in (see liveSpan). */
  live: { start: number; end: number }
  /** Who has a birthday: "MM-DD" to the names. */
  birthdays?: Map<string, string[]>
  children: ReactNode
}

/**
 * Table, month and day header of a timeline. Both views of the plan share it, so that scrolling, zoom
 * and folded weekends work the same in both.
 */
function TimelineFrame({ days, holidayByDate, today, zoom, foldWeekends, corner, byEmployee = false, live, birthdays, children }: FrameProps) {
  const weekends = days.filter((day) => day.isWeekend).length

  return (
    <table
      className={`timeline zoom-${zoom}${foldWeekends ? ' fold-weekends' : ''}${byEmployee ? ' by-employee' : ''}`}
      style={{ '--weekdays': days.length - weekends, '--weekends': weekends } as CSSProperties}
    >
      <DayColumns days={days} />
      <thead>
        <tr className="month-row">
          <th className="corner" rowSpan={2}>
            {corner}
          </th>
          <MonthCells days={days} />
        </tr>
        <tr className="day-row">
          <DayHeads days={days} holidayByDate={holidayByDate} today={today} zoom={zoom} start={live.start} end={live.end} birthdays={birthdays} />
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}

/**
 * What pointing anywhere at a field shows: its entries with their notes, and the notes of the field (calendar
 * notes) in full, title and text, also when the mouse is not right on the short note.
 */
function cellTitle(entries: Entry[], label: (entry: Entry) => string, calendarNotes: CalendarNote[] = []) {
  const lines: string[] = []
  if (entries.length > 0) {
    const notes = entries.map((entry) => entry.note).filter(Boolean).join(' / ')
    const important = entries.some((entry) => entry.noteImportant)
    lines.push(entries.map(label).join(' / ') + (notes ? `\n${important ? 'WICHTIG: ' : 'Notiz: '}${notes}` : ''))
  }
  for (const note of calendarNotes) lines.push(`Notiz: ${note.title}${note.text ? `\n${note.text}` : ''}`)
  return lines.length > 0 ? lines.join('\n') : undefined
}

/** Short form of a cell: the first entry, a counter for the others, and the note sign. */
function Compact({
  entries,
  text,
  dimmed,
  onTextClick,
  draggable = false,
  reserved = false,
}: {
  entries: Entry[]
  text: string
  dimmed: boolean
  onTextClick?: (event: MouseEvent) => void
  /** Dragging the short form moves its first entry. */
  draggable?: boolean
  /** The first entry is a reserved day (framed in black on white). */
  reserved?: boolean
}) {
  const first = entries[0]
  return (
    <span
      className={['cell-compact', `compact-${first.type.toLowerCase()}`, dimmed ? 'dimmed' : '', draggable ? 'drag-source' : '', reserved ? 'reserved' : ''].join(' ')}
      style={entryStyle(first)}
      {...dragSource({ kind: 'entry', entry: first }, draggable)}
    >
      <span className="compact-name" onClick={onTextClick}>
        {text}
      </span>
      {entries.length > 1 && <span className="compact-more">+{entries.length - 1}</span>}
      {entries.some((entry) => entry.note) && <NoteMark important={entries.some((entry) => entry.noteImportant)} />}
    </span>
  )
}

/**
 * The days filled in, as positions in `days`: the others are one empty field before and one after (the columns
 * keep their widths), so a phone draws a few weeks and not the whole year.
 */
function liveSpan(days: Day[], live: { from: string; to: string } | undefined) {
  if (!live) return { start: 0, end: days.length }
  const start = days.findIndex((day) => day.iso >= live.from)
  const after = days.findIndex((day) => day.iso > live.to)
  return { start: start < 0 ? days.length : start, end: after < 0 ? days.length : after }
}

// No entries, no notes: one array for all such fields, so that they count as unchanged (see EmployeeCell).
const NO_ENTRIES: Entry[] = []
const NO_NOTES: CalendarNote[] = []

type Handler = (event: unknown) => void

/**
 * Drop handlers that ask for the current ones when something is dragged over or dropped: a field that is not
 * drawn anew still drops with what is current then.
 */
function lateDrop(get: () => DropHandlers | undefined): DropHandlers {
  const call = (name: string) => (event: unknown) => (get()?.[name] as Handler | undefined)?.(event)
  return { onDragEnter: call('onDragEnter'), onDragOver: call('onDragOver'), onDragLeave: call('onDragLeave'), onDrop: call('onDrop') }
}

/** What the fields of the plan by employee call when something happens: always the current ones. */
interface EmployeeCellContext {
  props: MatrixProps
  handlers: ReturnType<typeof useCellSelection>['handlers']
  openSite: (siteId: number, event: MouseEvent) => void
}

interface EmployeeCellProps {
  context: RefObject<EmployeeCellContext | null>
  employee: PlanEmployee
  employeeIndex: number
  day: Day
  dayIndex: number
  entries: Entry[]
  notes: CalendarNote[]
  holiday: SchoolHoliday | undefined
  today: string
  selected: boolean
  /** Per entry "1" when it is dimmed, "0" when not; the same for reserved. */
  dimmed: string
  reserved: string
  /** Only for a field with a marked or found entry: other fields stay as they are when these change. */
  marked: MatrixProps['marked']
  found: Set<number> | undefined
  draggable: boolean
  marks: boolean
  opensFree: boolean
  showsFree: boolean
  stretches: boolean
  noteMenu: boolean
  opensNotes: boolean
}

/**
 * One field of the plan by employee: an employee on a day. It is drawn anew only when what it shows changes, so
 * that paging and wiping (and every change elsewhere in the plan) do not draw all the fields again.
 */
const EmployeeCell = memo(function EmployeeCell(cell: EmployeeCellProps) {
  const { context, employee, employeeIndex, day, dayIndex, entries, notes } = cell
  const now = () => context.current!
  const props = () => now().props
  const first = entries[0]
  // Only half a day on sites: the other half is free. One entry dragged onto it moves there.
  const free = cell.showsFree && onlyHalfDay(entries)
  const afternoon = free && (first.startTime ?? '') >= '12:00'
  const freeChip = (
    <span
      className="chip chip-baustelle chip-half-free"
      style={entryStyle({ type: 'Baustelle', activity: null, siteName: null })}
      title={cell.opensFree ? 'verfügbar: klicken, um hier eine Baustelle einzutragen' : 'verfügbar: dieser Teil des Tages ist frei'}
      {...(entries.length === 1 ? lateDrop(() => props().dropOnFree?.(first)) : {})}
      onClick={
        cell.opensFree
          ? (event) => {
              // The free half opens, not the marking of the cell.
              event.stopPropagation()
              props().onOpenFree?.(employee, day.iso, afternoon ? HALF_DAYS[0] : HALF_DAYS[1])
            }
          : undefined
      }
    >
      <span className="chip-line">
        <span className="chip-name">verfügbar</span>
      </span>
    </span>
  )
  // The selection of the plan, asked for when the event comes.
  const on = (name: string) => (event: unknown) =>
    (now().handlers(employeeIndex, dayIndex) as unknown as Record<string, Handler>)[name](event)
  const openSite = (siteId: number, event: MouseEvent) => now().openSite(siteId, event)
  const marked = cell.marked
  return (
    <td
      className={dayClass(day, cell.holiday, cell.today)}
      data-stretch-row={`e${employee.id}`}
      data-stretch-date={day.iso}
      {...(cell.draggable ? lateDrop(() => props().dropOn?.(employee, day.iso)) : {})}
    >
      <button
        type="button"
        className={cell.selected ? 'cell selected' : 'cell'}
        aria-label={`${employee.name}, ${formatDateLong(day.iso)}`}
        aria-pressed={cell.selected || undefined}
        data-cell={cellKey(employee.id, day.iso)}
        title={cellTitle(entries, entryTitle, notes)}
        onPointerDown={on('onPointerDown')}
        onPointerEnter={on('onPointerEnter')}
        onPointerMove={on('onPointerMove')}
        onPointerUp={on('onPointerUp')}
        onPointerCancel={on('onPointerCancel')}
        onDragStart={on('onDragStart')}
        onContextMenu={on('onContextMenu')}
        onClick={on('onClick')}
        onDoubleClick={on('onDoubleClick')}
      >
        <span className="cell-full">
          {/* Work in the afternoon only: the free morning comes first. */}
          {free && afternoon && freeChip}
          {entries.map((entry, index) => (
            <Chip
              key={entry.id}
              entry={entry}
              dimmed={cell.dimmed[index] === '1'}
              reserved={cell.reserved[index] === '1'}
              // Marking takes the click; the site opens from the right-click menu then.
              onSiteClick={cell.marks ? undefined : openSite}
              draggable={cell.draggable}
              drop={cell.draggable ? lateDrop(() => props().dropOnEntry?.(entry)) : undefined}
              marked={marked?.ids.has(entry.id)}
              found={cell.found?.has(entry.id)}
              stretch={
                cell.stretches && marked && (marked.first === entry.id || marked.last === entry.id)
                  ? {
                      left: marked.first === entry.id,
                      right: marked.last === entry.id,
                      // Its last entry also takes the stretch down to the employees below.
                      down: marked.last === entry.id,
                      onStart: (side, event) => props().onStretchStart?.(entry, side, event),
                    }
                  : undefined
              }
            />
          ))}
          {free && !afternoon && freeChip}
        </span>
        {first && (
          <Compact
            entries={entries}
            text={serviceName(entryName(first)) ?? entryName(first)}
            dimmed={!cell.dimmed.includes('0')}
            reserved={cell.reserved[0] === '1'}
            onTextClick={cell.marks ? undefined : (event) => first.siteId !== null && openSite(first.siteId, event)}
            draggable={cell.draggable}
          />
        )}
        {notes.length > 0 && (
          <CellNotes
            notes={notes}
            onOpen={cell.opensNotes ? (note) => props().onOpenNote?.(note) : undefined}
            onMenu={cell.noteMenu ? (note, event) => props().onNoteMenu?.(note, { x: event.clientX, y: event.clientY }) : undefined}
          />
        )}
      </button>
    </td>
  )
})

/** A mask of one character per entry: "1" where the test holds. */
const mask = (entries: Entry[], test: ((entry: Entry) => boolean) | undefined) =>
  test && entries.length > 0 ? entries.map((entry) => (test(entry) ? '1' : '0')).join('') : ''

/**
 * The plan by employee: one row per employee, the days from left to right. The employee column stays
 * in place while the days scroll sideways. The zoom decides how wide a day is and how much of an entry
 * fits: the whole entry (week), the site name (month) or just the colour of the activity (year).
 */
export function TimelineMatrix(props: MatrixProps) {
  const { days, employees, entriesOf, holidayByDate, today, isDimmed, linkNames, selected, zoom, foldWeekends, dropOn } = props
  const draggable = dropOn !== undefined
  const { handlers, siteClickBelongsToCell } = useCellSelection(props, days)
  const names = useMemo(() => shortNames(employees), [employees])
  const { start: liveStart, end: liveEnd } = liveSpan(days, props.live)
  const openSite = (siteId: number, event: MouseEvent) => {
    if (siteClickBelongsToCell()) return
    event.stopPropagation()
    props.onOpenSite(siteId)
  }
  // The current props for the fields, which are not all drawn anew (see EmployeeCell).
  const context = useRef<EmployeeCellContext | null>(null)
  useLayoutEffect(() => {
    context.current = { props, handlers, openSite }
  })
  const marked = props.marked
  const found = props.found

  return (
    <TimelineFrame
      days={days}
      holidayByDate={holidayByDate}
      today={today}
      zoom={zoom}
      foldWeekends={foldWeekends}
      corner={props.corner ?? 'Mitarbeiter'}
      byEmployee
      live={{ start: liveStart, end: liveEnd }}
      birthdays={props.birthdays}
    >
      {employees.map((employee, employeeIndex) => (
        <tr key={employee.id}>
          <th className="employee" scope="row" title={employee.name}>
            <EmployeeName employee={employee} link={linkNames} label={names.get(employee.id)} />
          </th>
          {liveStart > 0 && <td colSpan={liveStart} className="live-gap" />}
          {days.slice(liveStart, liveEnd).map((day, index) => {
            const all = entriesOf(employee.id, day.iso)
            // Without "verfügbar" (the offer phase): a half kept free is left out of the field as well.
            const listed = props.showsFree === false && all.some(isFree) ? all.filter((entry) => !isFree(entry)) : all
            const entries = listed.length > 0 ? listed : NO_ENTRIES
            const noted = props.notesOf?.(employee.id, day.iso) ?? NO_NOTES
            return (
              <EmployeeCell
                key={day.iso}
                context={context}
                employee={employee}
                employeeIndex={employeeIndex}
                day={day}
                dayIndex={liveStart + index}
                entries={entries}
                notes={noted.length > 0 ? noted : NO_NOTES}
                holiday={holidayByDate.get(day.iso)}
                today={today}
                selected={selected.has(cellKey(employee.id, day.iso))}
                dimmed={mask(entries, isDimmed)}
                reserved={mask(entries, props.isReserved)}
                marked={marked && entries.some((entry) => marked.ids.has(entry.id)) ? marked : undefined}
                found={found && entries.some((entry) => found.has(entry.id)) ? found : undefined}
                draggable={draggable}
                marks={!!props.onMark}
                opensFree={!!props.onOpenFree}
                showsFree={props.showsFree !== false}
                stretches={!!props.onStretchStart}
                noteMenu={!!props.onNoteMenu}
                opensNotes={!!props.onOpenNote}
              />
            )
          })}
          {liveEnd < days.length && <td colSpan={days.length - liveEnd} className="live-gap" />}
        </tr>
      ))}
    </TimelineFrame>
  )
}

export interface SiteRow {
  site: Site
  /** The entries at this site, per day. */
  byDate: Map<string, Entry[]>
}

interface SiteTimelineProps {
  /** Who has a birthday (see MatrixProps.birthdays). */
  birthdays?: Map<string, string[]>
  /** In place of the word in the corner, e.g. the choice of the employees on a phone. */
  corner?: ReactNode
  /** A reserved day of an offer site: framed in black on white. */
  isReserved?: (entry: Entry) => boolean
  days: Day[]
  rows: SiteRow[]
  holidayByDate: Map<string, SchoolHoliday>
  today: string
  zoom: 'week' | 'month'
  foldWeekends?: boolean
  /** A day of a site: who is there, and (for planners) who else should go. */
  onOpenCell: (site: Site, date: string) => void
  onOpenSite: (siteId: number) => void
  /** Planners: entries and employees can be dragged onto a cell of a site and a day. */
  dropOn?: (site: Site, date: string) => DropHandlers
  /** Planners: an activity dragged onto an entry becomes its activity. */
  dropOnEntry?: (entry: Entry) => DropHandlers
  /** Planners: a right click on a cell opens a menu (copy, cut, paste) at the pointer. */
  onCellMenu?: (site: Site, date: string, at: { x: number; y: number; entryId?: number }) => void
  /** Planners: the marked entries (an employee's stretch of days at a site) and the entries at its ends. */
  marked?: { ids: Set<number>; first: number; last: number }
  /** The entries of the site searched for: highlighted. */
  found?: Set<number>
  /** The days filled in (see MatrixProps.live). */
  live?: { from: string; to: string }
  /** Planners: a click on an employee in a cell marks the entry; a click elsewhere in the cell opens the day. */
  onMark?: (entry: Entry | null) => void
  /** Planners: an end of the marked stretch is dragged, to the following days or back. */
  onStretchStart?: (entry: Entry, side: 'left' | 'right' | 'down', event: PointerEvent) => void
}

interface SiteCellProps {
  context: RefObject<SiteTimelineProps | null>
  site: Site
  day: Day
  entries: Entry[]
  /** The first names of the employees in the field, one per entry. */
  labels: string
  holiday: SchoolHoliday | undefined
  today: string
  reserved: string
  marked: SiteTimelineProps['marked']
  found: Set<number> | undefined
  draggable: boolean
  stretches: boolean
}

const LABELS = '\u0001'

/** One field of the plan by site: a site on a day. Drawn anew only when what it shows changes. */
const SiteCell = memo(function SiteCell(cell: SiteCellProps) {
  const { context, site, day, entries } = cell
  const props = () => context.current!
  const labels = cell.labels.split(LABELS)
  const marked = cell.marked
  return (
    <td
      className={dayClass(day, cell.holiday, cell.today)}
      data-stretch-row={`s${site.id}`}
      data-stretch-date={day.iso}
      {...(cell.draggable ? lateDrop(() => props().dropOn?.(site, day.iso)) : {})}
    >
      <button
        type="button"
        className="cell"
        aria-label={`${site.name}, ${formatDateLong(day.iso)}`}
        title={cellTitle(entries, (entry) => entryTitle({ ...entry, siteName: entry.employeeName }))}
        onClick={(event) => {
          const current = props()
          if (current.onMark) {
            const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-entry-id]')
            const entry = chip && entries.find((candidate) => candidate.id === Number(chip.dataset.entryId))
            current.onMark(entry ?? null)
            if (entry) return
          }
          current.onOpenCell(site, day.iso)
        }}
        onContextMenu={(event) => {
          const current = props()
          if (!current.onCellMenu) return
          event.preventDefault()
          const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-entry-id]')
          current.onCellMenu(site, day.iso, { x: event.clientX, y: event.clientY, entryId: chip ? Number(chip.dataset.entryId) : undefined })
        }}
      >
        <span className="cell-full">
          {entries.map((entry, index) => (
            <Chip
              key={entry.id}
              entry={entry}
              label={labels[index]}
              reserved={cell.reserved[index] === '1'}
              draggable={cell.draggable}
              drop={cell.draggable ? lateDrop(() => props().dropOnEntry?.(entry)) : undefined}
              marked={marked?.ids.has(entry.id)}
              found={cell.found?.has(entry.id)}
              stretch={
                cell.stretches && marked && (marked.first === entry.id || marked.last === entry.id)
                  ? {
                      left: marked.first === entry.id,
                      right: marked.last === entry.id,
                      onStart: (side, event) => props().onStretchStart?.(entry, side, event),
                    }
                  : undefined
              }
            />
          ))}
        </span>
        {entries.length > 0 && (
          <Compact entries={entries} text={labels[0]} dimmed={false} draggable={cell.draggable} reserved={cell.reserved[0] === '1'} />
        )}
      </button>
    </td>
  )
})

/**
 * The plan by construction site: one row per site, the days from left to right, and in the cells the
 * employees working there, in the colour of their activity.
 */
export function SiteTimeline(props: SiteTimelineProps) {
  const { days, rows, holidayByDate, today, zoom, foldWeekends, onOpenSite, dropOn, marked, found } = props
  const siteLive = liveSpan(days, props.live)
  const draggable = dropOn !== undefined
  // The people in the fields by their first names, as in the plan by employee.
  const names = useMemo(() => {
    const people = new Map<number, NamedItem>()
    for (const row of rows) for (const list of row.byDate.values()) for (const entry of list) people.set(entry.employeeId, { id: entry.employeeId, name: entry.employeeName })
    return shortNames([...people.values()])
  }, [rows])
  const nameOf = (entry: Entry) => names.get(entry.employeeId) ?? entry.employeeName
  const context = useRef<SiteTimelineProps | null>(null)
  useLayoutEffect(() => {
    context.current = props
  })
  return (
    <TimelineFrame
      days={days}
      holidayByDate={holidayByDate}
      today={today}
      zoom={zoom}
      foldWeekends={foldWeekends}
      corner={props.corner ?? 'Baustelle'}
      live={siteLive}
      birthdays={props.birthdays}
    >
      {rows.map(({ site, byDate }) => (
        <tr key={site.id}>
          <th className="employee site-head" scope="row" title={site.client ?? site.name}>
            <span className="site-link" role="link" onClick={() => onOpenSite(site.id)}>
              {site.name}
            </span>
          </th>
          {siteLive.start > 0 && <td colSpan={siteLive.start} className="live-gap" />}
          {days.slice(siteLive.start, siteLive.end).map((day) => {
            const entries = byDate.get(day.iso) ?? NO_ENTRIES
            return (
              <SiteCell
                key={day.iso}
                context={context}
                site={site}
                day={day}
                entries={entries}
                labels={entries.map(nameOf).join(LABELS)}
                holiday={holidayByDate.get(day.iso)}
                today={today}
                reserved={mask(entries, props.isReserved)}
                marked={marked && entries.some((entry) => marked.ids.has(entry.id)) ? marked : undefined}
                found={found && entries.some((entry) => found.has(entry.id)) ? found : undefined}
                draggable={draggable}
                stretches={!!props.onStretchStart}
              />
            )
          })}
          {siteLive.end < days.length && <td colSpan={days.length - siteLive.end} className="live-gap" />}
        </tr>
      ))}
    </TimelineFrame>
  )
}
