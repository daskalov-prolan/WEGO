import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import type { Activity, Entry, NamedItem, PlanEmployee, SchoolHoliday, Site } from '../api/types'
import { ActivityIcon } from './ActivityIcon'
import { TaskBox } from './TaskBox'
import type { Day } from '../lib/dates'
import { formatDateLong, MONTHS } from '../lib/dates'
import { activityLabel, ACTIVITIES, entryStyle, entryTitle } from '../lib/activities'
import { cellKey } from '../lib/ui'
import { Chip, NoteMark } from './Chip'

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
  /** Plan by employee: open tasks of sites in the employee's main activity, shown in a second column. */
  employeeTasks?: (employee: PlanEmployee) => { site: Site; task: OpenTask }[]
  firstVisible?: string
  onPlanTask?: (site: Site, activity: Activity, employeeIds: number[], date: string) => Promise<void>
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

function dayClass(day: Day, holiday: SchoolHoliday | undefined, today: string) {
  return [
    day.isWeekend ? 'weekend' : '',
    holiday ? (holiday.kind === 'Feiertag' ? 'public-holiday' : 'holiday') : '',
    day.iso === today ? 'today' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

interface FrameProps {
  days: Day[]
  holidayByDate: Map<string, SchoolHoliday>
  today: string
  zoom: 'week' | 'month' | 'year'
  foldWeekends?: boolean
  /** Heading of the column on the left: "Mitarbeiter" or "Baustelle". */
  corner: ReactNode
  /** A second fixed column next to the names (the unplanned activities in the plan by site). */
  withTasks?: boolean
  children: ReactNode
}

/**
 * Table, month and day header of a timeline. Both views of the plan share it, so that scrolling, zoom
 * and folded weekends work the same in both.
 */
function TimelineFrame({ days, holidayByDate, today, zoom, foldWeekends, corner, withTasks, children }: FrameProps) {
  const weekends = days.filter((day) => day.isWeekend).length
  const months: { month: number; count: number }[] = []
  for (const day of days) {
    if (months.at(-1)?.month === day.month) months[months.length - 1].count++
    else months.push({ month: day.month, count: 1 })
  }

  return (
    <table
      className={`timeline zoom-${zoom}${foldWeekends ? ' fold-weekends' : ''}${withTasks ? ' with-tasks' : ''}`}
      style={{ '--weekdays': days.length - weekends, '--weekends': weekends } as CSSProperties}
    >
      <colgroup>
        <col className="col-employee" />
        {withTasks && <col className="col-tasks" />}
        {days.map((day) => (
          <col key={day.iso} className={day.isWeekend ? 'col-day col-weekend' : 'col-day'} />
        ))}
      </colgroup>
      <thead>
        <tr className="month-row">
          <th className="corner" rowSpan={2} colSpan={withTasks ? 2 : 1}>
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
      <tbody>{children}</tbody>
    </table>
  )
}

function cellTitle(entries: Entry[], label: (entry: Entry) => string) {
  if (entries.length === 0) return undefined
  const notes = entries.map((entry) => entry.note).filter(Boolean).join(' / ')
  const important = entries.some((entry) => entry.noteImportant)
  return entries.map(label).join(' / ') + (notes ? `\n${important ? 'WICHTIG: ' : 'Notiz: '}${notes}` : '')
}

/** Short form of a cell: the first entry, a counter for the others, and the note sign. */
function Compact({ entries, text, dimmed, onTextClick }: { entries: Entry[]; text: string; dimmed: boolean; onTextClick?: (event: MouseEvent) => void }) {
  const first = entries[0]
  return (
    <span
      className={['cell-compact', `compact-${first.type.toLowerCase()}`, dimmed ? 'dimmed' : ''].join(' ')}
      style={entryStyle(first)}
    >
      <ActivityIcon activity={first.activity} type={first.type} />
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
  const { days, employees, entriesOf, holidayByDate, today, isDimmed, linkNames, selected, zoom, foldWeekends } = props
  const { handlers, siteClickBelongsToCell } = useCellSelection(props, days)
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
      withTasks={props.employeeTasks !== undefined}
      corner={
        props.employeeTasks ? (
          <span className="corner-split">
            <span>Mitarbeiter</span>
            <span>Ungeplant</span>
          </span>
        ) : (
          'Mitarbeiter'
        )
      }
    >
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
            {props.employeeTasks && (
              <td className="tasks">
                <EmployeeTasks
                  employee={employee}
                  tasks={props.employeeTasks(employee)}
                  days={days}
                  firstVisible={props.firstVisible ?? days[0].iso}
                  onPlanTask={props.onPlanTask}
                />
              </td>
            )}
            {days.map((day, dayIndex) => {
              const entries = entriesOf(employee.id, day.iso)
              const first = entries[0]
              const isSelected = selected.has(cellKey(employee.id, day.iso))
              return (
                <td key={day.iso} className={dayClass(day, holidayByDate.get(day.iso), today)}>
                  <button
                    type="button"
                    className={isSelected ? 'cell selected' : 'cell'}
                    aria-label={`${employee.name}, ${formatDateLong(day.iso)}`}
                    aria-pressed={isSelected || undefined}
                    title={cellTitle(entries, entryTitle)}
                    {...handlers(employeeIndex, dayIndex)}
                  >
                    <span className="cell-full">
                      {entries.map((entry) => (
                        <Chip key={entry.id} entry={entry} dimmed={isDimmed(entry)} onSiteClick={openSite} />
                      ))}
                    </span>
                    {first && (
                      <Compact
                        entries={entries}
                        text={first.type === 'Baustelle' ? (first.siteName ?? '') : first.type}
                        dimmed={entries.every(isDimmed)}
                        onTextClick={(event) => first.siteId !== null && openSite(first.siteId, event)}
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

/** The open tasks of one employee: the first three, the others on request. */
function EmployeeTasks({
  employee,
  tasks,
  days,
  firstVisible,
  onPlanTask,
}: {
  employee: PlanEmployee
  tasks: { site: Site; task: OpenTask }[]
  days: Day[]
  firstVisible: string
  onPlanTask?: (site: Site, activity: Activity, employeeIds: number[], date: string) => Promise<void>
}) {
  const [all, setAll] = useState(false)
  const shown = all ? tasks : tasks.slice(0, 3)
  return (
    <>
      {shown.map(({ site, task }) => (
        <TaskBox
          key={`${site.id}|${task.activity}`}
          task={task}
          label={site.name}
          employees={[employee]}
          employee={employee}
          defaultDate={firstVisible}
          minDate={days[0].iso}
          maxDate={days[days.length - 1].iso}
          onPlan={onPlanTask && ((employeeIds, date) => onPlanTask(site, task.activity, employeeIds, date))}
        />
      ))}
      {tasks.length > 3 && (
        <button type="button" className="task-more" onClick={() => setAll((value) => !value)}>
          {all ? 'weniger' : `+ ${tasks.length - 3} weitere`}
        </button>
      )}
    </>
  )
}

export interface OpenTask {
  activity: Activity
  /** Employee days planned with this activity at the site, and how many are expected. */
  planned: number
  estimated: number
}

export interface SiteRow {
  site: Site
  /** The entries at this site, per day. */
  byDate: Map<string, Entry[]>
  /** Activities of the current status that are not fully planned yet. */
  openTasks: OpenTask[]
}

interface SiteTimelineProps {
  days: Day[]
  rows: SiteRow[]
  holidayByDate: Map<string, SchoolHoliday>
  today: string
  zoom: 'week' | 'month' | 'year'
  foldWeekends?: boolean
  /** A day of a site: who is there, and (for planners) who else should go. */
  onOpenCell: (site: Site, date: string) => void
  onOpenSite: (siteId: number) => void
  /** Who can do an activity on this site (for planning an open task). */
  candidates: (site: Site, activity: Activity) => PlanEmployee[]
  /** First day in view: offered when planning an open task. */
  firstVisible: string
  /** Planners: plan an open task, or mark it as not needed. */
  onPlanTask?: (site: Site, activity: Activity, employeeIds: number[], date: string) => Promise<void>
  onTaskNotNeeded?: (site: Site, activity: Activity) => Promise<void>
}

/**
 * The plan by construction site: one row per site, the days from left to right, and in the cells the
 * employees working there, in the colour of their activity.
 */
export function SiteTimeline(props: SiteTimelineProps) {
  const { days, rows, holidayByDate, today, zoom, foldWeekends, onOpenCell, onOpenSite, onPlanTask, onTaskNotNeeded } = props
  return (
    <TimelineFrame
      days={days}
      holidayByDate={holidayByDate}
      today={today}
      zoom={zoom}
      foldWeekends={foldWeekends}
      withTasks
      corner={
        <span className="corner-split">
          <span>Baustelle</span>
          <span>Ungeplant</span>
        </span>
      }
    >
      {rows.map(({ site, byDate, openTasks }) => (
        <tr key={site.id}>
          <th className="employee site-head" scope="row" title={site.client ?? site.name}>
            <span className="site-link" role="link" onClick={() => onOpenSite(site.id)}>
              {site.name}
            </span>
          </th>
          <td className="tasks">
            {openTasks.map((task) => (
              <TaskBox
                key={task.activity}
                task={task}
                employees={props.candidates(site, task.activity)}
                defaultDate={props.firstVisible}
                minDate={days[0].iso}
                maxDate={days[days.length - 1].iso}
                onPlan={onPlanTask && ((employeeIds, date) => onPlanTask(site, task.activity, employeeIds, date))}
                onNotNeeded={onTaskNotNeeded && (() => onTaskNotNeeded(site, task.activity))}
              />
            ))}
          </td>
          {days.map((day) => {
            const entries = byDate.get(day.iso) ?? []
            return (
              <td key={day.iso} className={dayClass(day, holidayByDate.get(day.iso), today)}>
                <button
                  type="button"
                  className="cell"
                  aria-label={`${site.name}, ${formatDateLong(day.iso)}`}
                  title={cellTitle(entries, (entry) => entryTitle({ ...entry, siteName: entry.employeeName }))}
                  onClick={() => onOpenCell(site, day.iso)}
                >
                  <span className="cell-full">
                    {entries.map((entry) => (
                      <Chip key={entry.id} entry={entry} label={entry.employeeName} />
                    ))}
                  </span>
                  {entries.length > 0 && <Compact entries={entries} text={entries[0].employeeName} dimmed={false} />}
                </button>
              </td>
            )
          })}
        </tr>
      ))}
    </TimelineFrame>
  )
}