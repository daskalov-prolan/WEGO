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
  /** With a customer filter: entries of other customers are dimmed. */
  isDimmed: (entry: Entry) => boolean
  /** Planners get links from the names into the employee report. */
  linkNames: boolean
  onOpen: (employee: PlanEmployee, date: string) => void
  /** Planners can select several cells: drag with the mouse, Ctrl+click, or long press on touch screens. */
  selectable: boolean
  selected: Set<string>
  onSelectedChange: (selected: Set<string>) => void
  /** Week view: an empty Saturday or Sunday shrinks to a thin row. */
  foldEmptyWeekends?: boolean
  /** Year view: a heading row at the start of every month. */
  monthHeadings?: boolean
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

/**
 * The plan as in the Excel sheet: days from top to bottom, one column per employee. The same table
 * serves week, month and year. The columns share the available width; with little room (phone, half a
 * browser window) the cells shrink to the first site plus a counter and the table scrolls sideways
 * while the day column stays in place.
 */
export function DayMatrix(props: MatrixProps) {
  const { days, employees, entriesOf, holidayByDate, today, isDimmed, linkNames, selected } = props
  const isUsed = (iso: string) => employees.some((employee) => entriesOf(employee.id, iso).length > 0)
  const folded = new Set(
    props.foldEmptyWeekends ? days.filter((day) => day.isWeekend && !isUsed(day.iso)).map((day) => day.iso) : [],
  )
  const open = days.filter((day) => !folded.has(day.iso))
  const handlers = useCellSelection(props, open)

  return (
    <table className="matrix" style={{ '--columns': employees.length } as CSSProperties}>
      <colgroup>
        <col className="col-day" />
        {employees.map((employee) => (
          <col key={employee.id} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className="corner">Tag</th>
          {employees.map((employee) => {
            const main = ACTIVITIES.find((activity) => activity.value === employee.mainActivity)
            return (
              <th
                key={employee.id}
                title={main ? `${employee.name} – ${activityLabel(employee.mainActivity)}` : employee.name}
                style={main ? { boxShadow: `inset 0 -5px 0 ${main.background}` } : undefined}
              >
                <EmployeeName employee={employee} link={linkNames} />
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {days.map((day, index) => {
          const holiday = holidayByDate.get(day.iso)
          const isFolded = folded.has(day.iso)
          const rowClass = [
            day.isWeekend ? 'weekend' : '',
            holiday ? (holiday.kind === 'Feiertag' ? 'public-holiday' : 'holiday') : '',
            day.iso === today ? 'today' : '',
            isFolded ? 'folded' : '',
          ]
            .filter(Boolean)
            .join(' ')

          return [
            props.monthHeadings && (index === 0 || days[index - 1].month !== day.month) && (
              <tr className="month-row" key={`m-${day.month}`} id={`m-${day.month}`}>
                <th colSpan={employees.length + 1}>
                  {MONTHS[day.month]} {day.iso.slice(0, 4)}
                </th>
              </tr>
            ),
            <tr className={rowClass} key={day.iso} id={`d-${day.iso}`}>
              <th className="day" scope="row" title={holiday?.name}>
                <span className="wd">{day.weekday}</span>{' '}
                <span className="num">
                  {pad(day.dayOfMonth)}.{pad(day.month + 1)}.
                </span>
                {holiday && !isFolded && <span className="holiday-name">{holiday.name}</span>}
              </th>
              {employees.map((employee, employeeIndex) => {
                if (isFolded) return <td key={employee.id} />
                const entries = entriesOf(employee.id, day.iso)
                const first = entries[0]
                const isSelected = selected.has(cellKey(employee.id, day.iso))
                return (
                  <td key={employee.id}>
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
                          style={entryStyle(first)}
                          title={entries.map(entryTitle).join(' / ')}
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
            </tr>,
          ]
        })}
      </tbody>
    </table>
  )
}