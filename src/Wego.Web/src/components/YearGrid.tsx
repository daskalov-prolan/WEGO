import type { Entry, NamedItem } from '../api/types'
import type { Day } from '../lib/dates'
import { MONTHS } from '../lib/dates'
import { Chip } from './Chip'

interface Props {
  year: number
  /** The days to show: the whole year, or with a customer filter only the days with a match. */
  days: Day[]
  employees: NamedItem[]
  entriesOf: (employeeId: number, date: string) => Entry[]
  holidayByDate: Map<string, string>
  today: string
  isDimmed: (entry: Entry) => boolean
  linkNames: boolean
  onOpen: (employee: NamedItem, date: string) => void
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The whole year as in the Excel sheet: one row per day, one column per employee. For wide screens. */
export function YearGrid({ year, days, employees, entriesOf, holidayByDate, today, isDimmed, linkNames, onOpen }: Props) {
  const columns = employees.length + 2

  return (
    <table className="plan-table">
      <thead>
        <tr>
          <th className="col-date">Tag</th>
          <th className="col-holiday">Schulferien</th>
          {employees.map((employee) => (
            <th key={employee.id}>
              {linkNames ? (
                <a href={`#/mitarbeiter/${employee.id}`} style={{ color: 'inherit' }}>
                  {employee.name}
                </a>
              ) : (
                employee.name
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {days.map((day, index) => {
          const holiday = holidayByDate.get(day.iso)
          const className = [
            'day',
            day.isWeekend ? 'weekend' : '',
            holiday ? 'holiday' : '',
            day.iso === today ? 'today' : '',
          ]
            .filter(Boolean)
            .join(' ')

          return [
            (index === 0 || days[index - 1].month !== day.month) && (
              <tr className="month" key={`m-${day.month}`} id={`m-${day.month}`}>
                <th colSpan={columns}>
                  {MONTHS[day.month]} {year}
                </th>
              </tr>
            ),
            <tr className={className} key={day.iso} id={`d-${day.iso}`}>
              <th className="col-date" scope="row">
                {day.weekday} {pad(day.dayOfMonth)}.{pad(day.month + 1)}.
              </th>
              <td className="col-holiday">{holiday}</td>
              {employees.map((employee) => (
                <td key={employee.id}>
                  <button
                    type="button"
                    className="cell"
                    onClick={() => onOpen(employee, day.iso)}
                    aria-label={`${employee.name}, ${day.weekday} ${day.dayOfMonth}.${day.month + 1}.`}
                  >
                    {entriesOf(employee.id, day.iso).map((entry) => (
                      <Chip key={entry.id} entry={entry} dimmed={isDimmed(entry)} />
                    ))}
                  </button>
                </td>
              ))}
            </tr>,
          ]
        })}
      </tbody>
    </table>
  )
}
