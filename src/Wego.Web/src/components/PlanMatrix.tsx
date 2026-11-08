import { useEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import type { CalendarNote, Entry, NamedItem, PlanEmployee, SchoolHoliday, Site } from '../api/types'
import { CellNotes } from './CalendarNotes'
import type { Day } from '../lib/dates'
import { formatDateLong, HALF_DAYS, MONTHS } from '../lib/dates'
import { serviceName, entryName, entryStyle, entryTitle, isFree, onlyHalfDay } from '../lib/activities'
import { cellKey } from '../lib/ui'
import { dragSource } from '../lib/dragPlan'
import { Chip, NoteMark } from './Chip'

/** Handlers that make a cell a place to drop entries and open activities on (see dropTarget). */
type DropHandlers = Record<string, unknown>

export interface MatrixProps {
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
  /** Planners: a click on an entry kept free ("verfügbar") opens the day to put a site in its place. */
  onFillFree?: (employee: PlanEmployee, date: string) => void
  /** Planners: the marked entries (a stretch of days) and the entries at its ends. */
  marked?: { ids: Set<number>; first: number; last: number }
  /** The entries of the site searched for: highlighted. */
  found?: Set<number>
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
  children: ReactNode
}

/**
 * Table, month and day header of a timeline. Both views of the plan share it, so that scrolling, zoom
 * and folded weekends work the same in both.
 */
function TimelineFrame({ days, holidayByDate, today, zoom, foldWeekends, corner, byEmployee = false, children }: FrameProps) {
  const weekends = days.filter((day) => day.isWeekend).length
  const months: { month: number; count: number }[] = []
  for (const day of days) {
    if (months.at(-1)?.month === day.month) months[months.length - 1].count++
    else months.push({ month: day.month, count: 1 })
  }

  return (
    <table
      className={`timeline zoom-${zoom}${foldWeekends ? ' fold-weekends' : ''}${byEmployee ? ' by-employee' : ''}`}
      style={{ '--weekdays': days.length - weekends, '--weekends': weekends } as CSSProperties}
    >
      <colgroup>
        <col className="col-employee" />
        {days.map((day) => (
          <col key={day.iso} className={day.isWeekend ? 'col-day col-weekend' : 'col-day'} />
        ))}
      </colgroup>
      <thead>
        <tr className="month-row">
          <th className="corner" rowSpan={2}>
            {corner}
          </th>
          {months.map(({ month, count }) => (
            <th key={month} colSpan={count} className="month">
              <span>
                {MONTHS[month]} {days[0].iso.slice(0, 4)}
              </span>
            </th>
          ))}
        </tr>
        <tr className="day-row">
          {days.map((day) => {
            const holiday = holidayByDate.get(day.iso)
            return (
              <th
                key={day.iso}
                id={`col-${day.iso}`}
                className={`dayhead ${dayClass(day, holiday, today)}${day.weekday === 'Mo' ? ' week-start' : ''}`}
                title={holiday ? `${formatDateLong(day.iso)} – ${holiday.name}` : formatDateLong(day.iso)}
              >
                <span className="wd">{day.weekday}</span>
                <span className="num">
                  {zoom === 'week' ? ` ${pad(day.dayOfMonth)}.${pad(day.month + 1)}` : day.dayOfMonth}
                </span>
              </th>
            )
          })}
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
 * The plan by employee: one row per employee, the days from left to right. The employee column stays
 * in place while the days scroll sideways. The zoom decides how wide a day is and how much of an entry
 * fits: the whole entry (week), the site name (month) or just the colour of the activity (year).
 */
export function TimelineMatrix(props: MatrixProps) {
  const { days, employees, entriesOf, holidayByDate, today, isDimmed, linkNames, selected, zoom, foldWeekends, dropOn } = props
  const draggable = dropOn !== undefined
  const { handlers, siteClickBelongsToCell } = useCellSelection(props, days)
  const names = shortNames(employees)
  const openSite = (siteId: number, event: MouseEvent) => {
    if (siteClickBelongsToCell()) return
    event.stopPropagation()
    props.onOpenSite(siteId)
  }

  return (
    <TimelineFrame
      days={days}
      holidayByDate={holidayByDate}
      today={today}
      zoom={zoom}
      foldWeekends={foldWeekends}
      corner={props.corner ?? 'Mitarbeiter'}
      byEmployee
    >
      {employees.map((employee, employeeIndex) => {
        return (
          <tr key={employee.id}>
            <th className="employee" scope="row" title={employee.name}>
              <EmployeeName employee={employee} link={linkNames} label={names.get(employee.id)} />
            </th>
            {days.map((day, dayIndex) => {
              const entries = entriesOf(employee.id, day.iso)
              const notes = props.notesOf?.(employee.id, day.iso) ?? []
              const first = entries[0]
              // Only half a day on sites: the other half is free. One entry dragged onto it moves there.
              const free = onlyHalfDay(entries)
              const afternoon = free && (first.startTime ?? '') >= '12:00'
              const freeChip = (
                <span
                  className="chip chip-baustelle chip-half-free"
                  style={entryStyle({ type: 'Baustelle', activity: null, siteName: null })}
                  title={props.onOpenFree ? 'verfügbar: klicken, um hier eine Baustelle einzutragen' : 'verfügbar: dieser Teil des Tages ist frei'}
                  {...(entries.length === 1 ? props.dropOnFree?.(first) : {})}
                  onClick={
                    props.onOpenFree &&
                    ((event) => {
                      // The free half opens, not the marking of the cell.
                      event.stopPropagation()
                      props.onOpenFree!(employee, day.iso, afternoon ? HALF_DAYS[0] : HALF_DAYS[1])
                    })
                  }
                >
                  <span className="chip-line">
                    <span className="chip-name">verfügbar</span>
                  </span>
                </span>
              )
              const isSelected = selected.has(cellKey(employee.id, day.iso))
              return (
                <td
                  key={day.iso}
                  className={dayClass(day, holidayByDate.get(day.iso), today)}
                  data-stretch-row={`e${employee.id}`}
                  data-stretch-date={day.iso}
                  {...dropOn?.(employee, day.iso)}
                >
                  <button
                    type="button"
                    className={isSelected ? 'cell selected' : 'cell'}
                    aria-label={`${employee.name}, ${formatDateLong(day.iso)}`}
                    aria-pressed={isSelected || undefined}
                    data-cell={cellKey(employee.id, day.iso)}
                    title={cellTitle(entries, entryTitle, notes)}
                    {...handlers(employeeIndex, dayIndex)}
                  >
                    <span className="cell-full">
                      {/* Work in the afternoon only: the free morning comes first. */}
                      {free && afternoon && freeChip}
                      {entries.map((entry) => (
                        <Chip
                          key={entry.id}
                          entry={entry}
                          dimmed={isDimmed(entry)}
                          reserved={props.isReserved?.(entry)}
                          // Marking takes the click; the site opens from the right-click menu then.
                          onSiteClick={props.onMark ? undefined : openSite}
                          draggable={draggable}
                          drop={props.dropOnEntry?.(entry)}
                          marked={props.marked?.ids.has(entry.id)}
                          found={props.found?.has(entry.id)}
                          stretch={
                            props.onStretchStart && props.marked && (props.marked.first === entry.id || props.marked.last === entry.id)
                              ? {
                                  left: props.marked.first === entry.id,
                                  right: props.marked.last === entry.id,
                                  // Its last entry also takes the stretch down to the employees below.
                                  down: props.marked.last === entry.id,
                                  onStart: (side, event) => props.onStretchStart!(entry, side, event),
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
                        dimmed={entries.every(isDimmed)}
                        reserved={props.isReserved?.(first)}
                        onTextClick={props.onMark ? undefined : (event) => first.siteId !== null && openSite(first.siteId, event)}
                        draggable={draggable}
                      />
                    )}
                    {notes.length > 0 && (
                      <CellNotes
                        notes={notes}
                        onOpen={props.onOpenNote}
                        onMenu={props.onNoteMenu && ((note, event) => props.onNoteMenu!(note, { x: event.clientX, y: event.clientY }))}
                      />
                    )}
                  </button>
                </td>
              )
            })}
          </tr>
        )
      })}
    </TimelineFrame>
  )
}

export interface SiteRow {
  site: Site
  /** The entries at this site, per day. */
  byDate: Map<string, Entry[]>
}

interface SiteTimelineProps {
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
  /** Planners: a click on an employee in a cell marks the entry; a click elsewhere in the cell opens the day. */
  onMark?: (entry: Entry | null) => void
  /** Planners: an end of the marked stretch is dragged, to the following days or back. */
  onStretchStart?: (entry: Entry, side: 'left' | 'right' | 'down', event: PointerEvent) => void
}

/**
 * The plan by construction site: one row per site, the days from left to right, and in the cells the
 * employees working there, in the colour of their activity.
 */
export function SiteTimeline(props: SiteTimelineProps) {
  const { days, rows, holidayByDate, today, zoom, foldWeekends, onOpenCell, onOpenSite, dropOn, marked } = props
  const draggable = dropOn !== undefined
  // The people in the fields by their first names, as in the plan by employee.
  const people = new Map<number, NamedItem>()
  for (const row of rows) for (const list of row.byDate.values()) for (const entry of list) people.set(entry.employeeId, { id: entry.employeeId, name: entry.employeeName })
  const names = shortNames([...people.values()])
  const nameOf = (entry: Entry) => names.get(entry.employeeId) ?? entry.employeeName
  return (
    <TimelineFrame
      days={days}
      holidayByDate={holidayByDate}
      today={today}
      zoom={zoom}
      foldWeekends={foldWeekends}
      corner={props.corner ?? 'Baustelle'}
    >
      {rows.map(({ site, byDate }) => (
        <tr key={site.id}>
          <th className="employee site-head" scope="row" title={site.client ?? site.name}>
            <span className="site-link" role="link" onClick={() => onOpenSite(site.id)}>
              {site.name}
            </span>
          </th>
          {days.map((day) => {
            const entries = byDate.get(day.iso) ?? []
            return (
              <td
                key={day.iso}
                className={dayClass(day, holidayByDate.get(day.iso), today)}
                data-stretch-row={`s${site.id}`}
                data-stretch-date={day.iso}
                {...dropOn?.(site, day.iso)}
              >
                <button
                  type="button"
                  className="cell"
                  aria-label={`${site.name}, ${formatDateLong(day.iso)}`}
                  title={cellTitle(entries, (entry) => entryTitle({ ...entry, siteName: entry.employeeName }))}
                  onClick={(event) => {
                    if (props.onMark) {
                      const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-entry-id]')
                      const entry = chip && entries.find((candidate) => candidate.id === Number(chip.dataset.entryId))
                      props.onMark(entry ?? null)
                      if (entry) return
                    }
                    onOpenCell(site, day.iso)
                  }}
                  onContextMenu={(event) => {
                    if (!props.onCellMenu) return
                    event.preventDefault()
                    const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-entry-id]')
                    props.onCellMenu(site, day.iso, { x: event.clientX, y: event.clientY, entryId: chip ? Number(chip.dataset.entryId) : undefined })
                  }}
                >
                  <span className="cell-full">
                    {entries.map((entry) => (
                      <Chip
                        key={entry.id}
                        entry={entry}
                        label={nameOf(entry)}
                        reserved={props.isReserved?.(entry)}
                        draggable={draggable}
                        drop={props.dropOnEntry?.(entry)}
                        marked={marked?.ids.has(entry.id)}
                        found={props.found?.has(entry.id)}
                        stretch={
                          props.onStretchStart && marked && (marked.first === entry.id || marked.last === entry.id)
                            ? {
                                left: marked.first === entry.id,
                                right: marked.last === entry.id,
                                onStart: (side, event) => props.onStretchStart!(entry, side, event),
                              }
                            : undefined
                        }
                      />
                    ))}
                  </span>
                  {entries.length > 0 && (
                    <Compact entries={entries} text={nameOf(entries[0])} dimmed={false} draggable={draggable} reserved={props.isReserved?.(entries[0])} />
                  )}
                </button>
              </td>
            )
          })}
        </tr>
      ))}
    </TimelineFrame>
  )
}