import { useEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import type { Entry, NamedItem, PlanEmployee, SchoolHoliday } from '../api/types'
import type { Day } from '../lib/dates'
import { formatDateLong, MONTHS } from '../lib/dates'
import { activityLabel, ACTIVITIES, entryStyle, entryTitle } from '../lib/activities'
import { cellKey } from '../lib/ui'
import { Chip } from './Chip'

export interface MatrixProps {
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
  /** How much of the timeline fits on the screen: about a week, a month, or the whole year. */
  zoom: 'week' | 'month' | 'year'
  /** Saturdays and Sundays as narrow strips (about 0.5 cm). */
  foldWeekends?: boolean
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
      onContextMenu: (event: MouseEvent) => {
        if (selectable && pointerType.current !== 'mouse') event.preventDefault()
      },
      onClick: () => {
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
        onOpen(employee, day.iso)
      },
    }
  }

  return { handlers, siteClickBelongsToCell }
}

function EmployeeName({ employee, link }: { employee: NamedItem; link: boolean }) {
  return link ? <a href={`#/mitarbeiter/${employee.id}`}>{employee.name}</a> : <>{employee.name}</>
}

/** Small sign in the top right corner of a cell whose entries carry a note. */
function NoteIcon() {
  return (
    <svg className="note-icon" viewBox="0 0 16 16" aria-label="mit Notiz" role="img">
      <path d="M3 1.5h7l3 3v10H3z" fill="#fff" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M5.5 7.5h5M5.5 10h5M5.5 12.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function dayClass(day: Day, holiday: SchoolHoliday | undefined, today: string) {
  return [
    day.isWeekend ? 'weekend' : '',
    holiday ? (holiday.kind === 'Feiertag' ? 'public-holiday' : 'holiday') : '',
    day.iso === today ? 'today' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * The plan as a timeline: one row per employee, the days from left to right. The employee column stays
 * in place while the days scroll sideways. The zoom decides how wide a day is and how much of an entry
 * fits: the whole entry (week), the site name (month) or just the colour of the activity (year).
 */
export function TimelineMatrix(props: MatrixProps) {
  const { days, employees, entriesOf, holidayByDate, today, isDimmed, linkNames, selected, zoom, foldWeekends } = props
  const weekends = days.filter((day) => day.isWeekend).length
  const { handlers, siteClickBelongsToCell } = useCellSelection(props, days)
  const openSite = (siteId: number, event: MouseEvent) => {
    if (siteClickBelongsToCell()) return
    event.stopPropagation()
    props.onOpenSite(siteId)
  }

  const months: { month: number; count: number }[] = []
  for (const day of days) {
    if (months.at(-1)?.month === day.month) months[months.length - 1].count++
    else months.push({ month: day.month, count: 1 })
  }

  return (
    <table
      className={`timeline zoom-${zoom}${foldWeekends ? ' fold-weekends' : ''}`}
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
            Mitarbeiter
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
                className={`dayhead ${dayClass(day, holiday, today)}`}
                title={holiday ? `${formatDateLong(day.iso)} – ${holiday.name}` : formatDateLong(day.iso)}
              >
                <span className="wd">{day.weekday}</span>
                <span className="num">
                  {zoom === 'week' ? `${pad(day.dayOfMonth)}.${pad(day.month + 1)}.` : day.dayOfMonth}
                </span>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {employees.map((employee, employeeIndex) => {
          const main = ACTIVITIES.find((activity) => activity.value === employee.mainActivity)
          return (
            <tr key={employee.id}>
              <th
                className="employee"
                scope="row"
                title={main ? `${employee.name} – ${activityLabel(employee.mainActivity)}` : employee.name}
                style={main ? { boxShadow: `inset 5px 0 0 ${main.background}` } : undefined}
              >
                <EmployeeName employee={employee} link={linkNames} />
              </th>
              {days.map((day, dayIndex) => {
                const entries = entriesOf(employee.id, day.iso)
                const first = entries[0]
                const isSelected = selected.has(cellKey(employee.id, day.iso))
                const notes = entries.map((entry) => entry.note).filter(Boolean).join(' / ')
                return (
                  <td key={day.iso} className={dayClass(day, holidayByDate.get(day.iso), today)}>
                    <button
                      type="button"
                      className={['cell', isSelected ? 'selected' : '', notes ? 'has-note' : ''].filter(Boolean).join(' ')}
                      aria-label={`${employee.name}, ${formatDateLong(day.iso)}`}
                      aria-pressed={isSelected || undefined}
                      title={
                        entries.length
                          ? entries.map(entryTitle).join(' / ') + (notes ? `\nNotiz: ${notes}` : '')
                          : undefined
                      }
                      {...handlers(employeeIndex, dayIndex)}
                    >
                      <span className="cell-full">
                        {entries.map((entry) => (
                          <Chip key={entry.id} entry={entry} dimmed={isDimmed(entry)} onSiteClick={openSite} />
                        ))}
                      </span>
                      {first && (
                        <span
                          className={[
                            'cell-compact',
                            `compact-${first.type.toLowerCase()}`,
                            entries.every(isDimmed) ? 'dimmed' : '',
                          ].join(' ')}
                          style={entryStyle(first)}
                        >
                          <span
                            className="compact-name"
                            onClick={(event) => first.siteId !== null && openSite(first.siteId, event)}
                          >
                            {first.type === 'Baustelle' ? first.siteName : first.type}
                          </span>
                          {entries.length > 1 && <span className="compact-more">+{entries.length - 1}</span>}
                        </span>
                      )}
                      {notes && <NoteIcon />}
                    </button>
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}