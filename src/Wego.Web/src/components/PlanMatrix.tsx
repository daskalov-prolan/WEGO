import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'
import type { Entry, NamedItem } from '../api/types'
import type { Day } from '../lib/dates'
import { formatDateLong } from '../lib/dates'
import { cellKey, siteStyle } from '../lib/ui'
import { Chip } from './Chip'

export interface MatrixProps {
  days: Day[]
  employees: NamedItem[]
  entriesOf: (employeeId: number, date: string) => Entry[]
  holidayByDate: Map<string, string>
  today: string
  /** With a customer filter: entries of other customers are dimmed. */
  isDimmed: (entry: Entry) => boolean
  /** Planners get links from the names into the employee report. */
  linkNames: boolean
  onOpen: (employee: NamedItem, date: string) => void
  /** Planners can select several cells: drag with the mouse, Ctrl+click, or long press on touch screens. */
  selectable: boolean
  selected: Set<string>
  onSelectedChange: (selected: Set<string>) => void
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

  return (employeeIndex: number, dayIndex: number) => {
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
}

function EmployeeName({ employee, link }: { employee: NamedItem; link: boolean }) {
  return link ? <a href={`#/mitarbeiter/${employee.id}`}>{employee.name}</a> : <>{employee.name}</>
}

function dayClass(day: Day, props: Pick<MatrixProps, 'holidayByDate' | 'today'>) {
  return [
    day.isWeekend ? 'weekend' : '',
    props.holidayByDate.has(day.iso) ? 'holiday' : '',
    day.iso === props.today ? 'today' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * One week: employees in rows, weekdays in columns. The columns share the available width, an empty
 * weekend is folded to a narrow strip. In a narrow container every cell shrinks to its first entry
 * plus a counter; the full day opens on tap.
 */
export function WeekMatrix(props: MatrixProps) {
  const { days, employees, entriesOf, holidayByDate, isDimmed, linkNames, selected } = props
  const isUsed = (day: Day) => employees.some((employee) => entriesOf(employee.id, day.iso).length > 0)
  const folded = new Set(days.filter((day) => day.isWeekend && !isUsed(day)).map((day) => day.iso))
  const open = days.filter((day) => !folded.has(day.iso))
  const handlers = useCellSelection(props, open)

  return (
    <table className="matrix week-matrix">
      <colgroup>
        <col className="col-name" />
        {days.map((day) => (
          <col key={day.iso} className={folded.has(day.iso) ? 'col-folded' : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className="name" />
          {days.map((day) => (
            <th key={day.iso} className={dayClass(day, props)} title={holidayByDate.get(day.iso)}>
              <span className="wd">{day.weekday}</span>{' '}
              {!folded.has(day.iso) && (
                <span className="num">
                  {pad(day.dayOfMonth)}.{pad(day.month + 1)}.
                </span>
              )}
              {!folded.has(day.iso) && holidayByDate.has(day.iso) && (
                <span className="holiday-name">{holidayByDate.get(day.iso)}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {employees.map((employee, employeeIndex) => (
          <tr key={employee.id}>
            <th className="name" scope="row">
              <EmployeeName employee={employee} link={linkNames} />
            </th>
            {days.map((day) => {
              if (folded.has(day.iso)) return <td key={day.iso} className={dayClass(day, props)} />
              const entries = entriesOf(employee.id, day.iso)
              const first = entries[0]
              const isSelected = selected.has(cellKey(employee.id, day.iso))
              return (
                <td key={day.iso} className={dayClass(day, props)}>
                  <button
                    type="button"
                    className={isSelected ? 'cell selected' : 'cell'}
                    aria-label={`${employee.name}, ${formatDateLong(day.iso)}`}
                    aria-pressed={isSelected || undefined}
                    {...handlers(employeeIndex, open.indexOf(day))}
                  >
                    <span className="cell-full">
                      {entries.map((entry) => (
                        <Chip key={entry.id} entry={entry} dimmed={isDimmed(entry)} />
                      ))}
                    </span>
                    {first && (
                      <span
                        className={[
                          'cell-compact',
                          `compact-${first.type.toLowerCase()}`,
                          entries.every(isDimmed) ? 'dimmed' : '',
                        ].join(' ')}
                        style={first.type === 'Baustelle' ? siteStyle(first.customerId) : undefined}
                      >
                        <span className="compact-name">
                          {first.type === 'Baustelle' ? first.customerName : first.type}
                        </span>
                        {entries.length > 1 && <span className="compact-more">+{entries.length - 1}</span>}
                      </span>
                    )}
                  </button>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function code(entries: Entry[]): string {
  const first = entries[0]
  if (first.type !== 'Baustelle') return first.type[0]
  return (first.customerName ?? '').slice(0, 3)
}

/**
 * One month as an overview: employees in rows, one narrow column per day. A cell carries the colour
 * and the first letters of the site; the full day is in the tooltip and opens on tap.
 */
export function MonthMatrix(props: MatrixProps) {
  const { days, employees, entriesOf, holidayByDate, isDimmed, linkNames, selected } = props
  const handlers = useCellSelection(props, days)

  return (
    <table className="matrix month-matrix">
      <thead>
        <tr>
          <th className="name" />
          {days.map((day) => (
            <th key={day.iso} className={dayClass(day, props)} title={holidayByDate.get(day.iso)}>
              <span className="wd">{day.weekday}</span>
              <span className="num">{day.dayOfMonth}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {employees.map((employee, employeeIndex) => (
          <tr key={employee.id}>
            <th className="name" scope="row">
              <EmployeeName employee={employee} link={linkNames} />
            </th>
            {days.map((day, dayIndex) => {
              const entries = entriesOf(employee.id, day.iso)
              const summary = entries
                .map((entry) => (entry.type === 'Baustelle' ? entry.customerName : entry.type))
                .join(' / ')
              const isSelected = selected.has(cellKey(employee.id, day.iso))
              return (
                <td key={day.iso} className={dayClass(day, props)}>
                  <button
                    type="button"
                    className={[
                      'cell',
                      entries.length > 0 ? `cell-code code-${entries[0].type.toLowerCase()}` : '',
                      entries.length > 0 && entries.every(isDimmed) ? 'dimmed' : '',
                      isSelected ? 'selected' : '',
                    ].join(' ')}
                    style={entries[0]?.type === 'Baustelle' ? siteStyle(entries[0].customerId) : undefined}
                    title={summary || undefined}
                    aria-label={`${employee.name}, ${formatDateLong(day.iso)}${summary ? `: ${summary}` : ''}`}
                    aria-pressed={isSelected || undefined}
                    {...handlers(employeeIndex, dayIndex)}
                  >
                    {entries.length > 0 && code(entries)}
                    {entries.length > 1 && <sup>{entries.length}</sup>}
                  </button>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
