import type { Entry, NamedItem } from '../api/types'
import type { Day } from '../lib/dates'
import { formatDateLong } from '../lib/dates'
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
}

const pad = (n: number) => String(n).padStart(2, '0')

function EmployeeName({ employee, link }: { employee: NamedItem; link: boolean }) {
  return link ? <a href={`#/mitarbeiter/${employee.id}`}>{employee.name}</a> : <>{employee.name}</>
}

function dayClass(day: Day, props: Pick<MatrixProps, 'holidayByDate' | 'today'>, extra = '') {
  return [
    extra,
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
  const { days, employees, entriesOf, holidayByDate, isDimmed, linkNames, onOpen } = props
  const isUsed = (day: Day) => employees.some((employee) => entriesOf(employee.id, day.iso).length > 0)
  const folded = new Set(days.filter((day) => day.isWeekend && !isUsed(day)).map((day) => day.iso))

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
        {employees.map((employee) => (
          <tr key={employee.id}>
            <th className="name" scope="row">
              <EmployeeName employee={employee} link={linkNames} />
            </th>
            {days.map((day) => {
              const entries = entriesOf(employee.id, day.iso)
              const first = entries[0]
              return (
                <td key={day.iso} className={dayClass(day, props)}>
                  {!folded.has(day.iso) && (
                    <button
                      type="button"
                      className="cell"
                      onClick={() => onOpen(employee, day.iso)}
                      aria-label={`${employee.name}, ${formatDateLong(day.iso)}`}
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
                        >
                          <span className="compact-name">
                            {first.type === 'Baustelle' ? first.customerName : first.type}
                          </span>
                          {entries.length > 1 && <span className="compact-more">+{entries.length - 1}</span>}
                        </span>
                      )}
                    </button>
                  )}
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
 * One month as an overview: employees in rows, one narrow column per day. A cell carries colour and
 * the first letters of the site; the full day is in the tooltip and opens on tap.
 */
export function MonthMatrix(props: MatrixProps) {
  const { days, employees, entriesOf, holidayByDate, isDimmed, linkNames, onOpen } = props

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
        {employees.map((employee) => (
          <tr key={employee.id}>
            <th className="name" scope="row">
              <EmployeeName employee={employee} link={linkNames} />
            </th>
            {days.map((day) => {
              const entries = entriesOf(employee.id, day.iso)
              const summary = entries
                .map((entry) => (entry.type === 'Baustelle' ? entry.customerName : entry.type))
                .join(' / ')
              return (
                <td key={day.iso} className={dayClass(day, props)}>
                  <button
                    type="button"
                    className={[
                      'cell',
                      entries.length > 0 ? `code-${entries[0].type.toLowerCase()}` : '',
                      entries.length > 0 && entries.every(isDimmed) ? 'dimmed' : '',
                    ].join(' ')}
                    onClick={() => onOpen(employee, day.iso)}
                    title={summary || undefined}
                    aria-label={`${employee.name}, ${formatDateLong(day.iso)}${summary ? `: ${summary}` : ''}`}
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
