import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Entry, NamedItem, Plan } from '../api/types'
import { Chip } from '../components/Chip'
import { DayDialog } from '../components/DayDialog'
import { MobilePlan } from '../components/MobilePlan'
import { useIsPhone } from '../lib/useIsPhone'
import { daysBetween, daysOfYear, MONTHS, todayIso } from '../lib/dates'

interface Props {
  year: number
  canEdit: boolean
  /** Employee id of the signed-in user: the phone view starts with their own week. */
  userId?: number
}

const cellKey = (employeeId: number, date: string) => `${employeeId}|${date}`

/**
 * The staff plan. On wide screens the yearly overview as in the Excel sheet (one row per day, one column
 * per employee), on phones a day and week view.
 */
export function PlanPage({ year, canEdit, userId }: Props) {
  const isPhone = useIsPhone()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<{ employee: NamedItem; date: string } | null>(null)

  const load = useCallback(() => {
    api.plan(year).then(
      (data) => {
        setPlan(data)
        setError('')
      },
      (e) => setError(messageOf(e)),
    )
  }, [year])

  useEffect(load, [load])

  const days = useMemo(() => daysOfYear(year), [year])

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

  const holidayByDate = useMemo(() => {
    const map = new Map<string, string>()
    for (const holiday of plan?.schoolHolidays ?? []) {
      for (const day of daysBetween(holiday.startDate, holiday.endDate)) map.set(day.iso, holiday.name)
    }
    return map
  }, [plan])

  const needle = filter.trim().toLowerCase()
  const matches = useCallback(
    (entry: Entry) => needle !== '' && (entry.customerName ?? '').toLowerCase().includes(needle),
    [needle],
  )

  // With a customer filter only the days on which somebody works there are shown.
  const matchingDates = useMemo(() => {
    if (needle === '' || !plan) return null
    return new Set(plan.entries.filter(matches).map((entry) => entry.date))
  }, [plan, needle, matches])

  if (error) return <p className="error page">{error}</p>
  if (!plan) return null

  const dialog = editing && (
    <DayDialog
      key={cellKey(editing.employee.id, editing.date)}
      employee={editing.employee}
      date={editing.date}
      entries={entriesByCell.get(cellKey(editing.employee.id, editing.date)) ?? []}
      customers={plan.customers}
      onClose={() => setEditing(null)}
      onSaved={() => {
        setEditing(null)
        load()
      }}
    />
  )

  if (isPhone) {
    return (
      <>
        <MobilePlan
          key={year}
          year={year}
          employees={plan.employees}
          entriesOf={(employeeId, date) => entriesByCell.get(cellKey(employeeId, date)) ?? []}
          holidayByDate={holidayByDate}
          canEdit={canEdit}
          userId={userId}
          onEdit={(employee, date) => setEditing({ employee, date })}
        />
        {dialog}
      </>
    )
  }

  const visibleDays = matchingDates ? days.filter((day) => matchingDates.has(day.iso)) : days
  const filteredCustomer = plan.customers.find((customer) => customer.name.toLowerCase() === needle)
  const today = todayIso()
  const columns = plan.employees.length + 2

  return (
    <div className="plan">
      <div className="toolbar plan-toolbar">
        <label className="field">
          Nach Baustelle (Kunde) filtern
          <input
            list="plan-customers"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Kundenname"
            type="search"
          />
        </label>
        <datalist id="plan-customers">
          {plan.customers.map((customer) => (
            <option key={customer.id} value={customer.name} />
          ))}
        </datalist>

        {matchingDates ? (
          <span className="muted">
            {matchingDates.size} {matchingDates.size === 1 ? 'Tag' : 'Tage'} mit Einsätzen
            {filteredCustomer && (
              <>
                {' · '}
                <a href={`#/baustellen/${filteredCustomer.id}`}>Auswertung öffnen</a>
              </>
            )}
          </span>
        ) : (
          <>
            {year === Number(today.slice(0, 4)) && (
              <a className="btn" href={`#/plan`} onClick={() => scrollToRow(`d-${today}`)}>
                Heute
              </a>
            )}
            <div className="month-links">
              {MONTHS.map((month, index) => (
                <a key={month} href="#/plan" onClick={() => scrollToRow(`m-${index}`)}>
                  {month.slice(0, 3)}
                </a>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="plan-scroll">
        <table className="plan-table">
          <thead>
            <tr>
              <th className="col-date">Tag</th>
              <th className="col-holiday">Schulferien</th>
              {plan.employees.map((employee) => (
                <th key={employee.id}>
                  <a href={`#/mitarbeiter/${employee.id}`} style={{ color: 'inherit' }}>
                    {employee.name}
                  </a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.employees.length === 0 && (
              <tr>
                <td colSpan={columns} style={{ padding: 16 }}>
                  Noch keine Mitarbeiter angelegt.
                  {canEdit && (
                    <>
                      {' '}
                      <a href="#/verwaltung">Zur Verwaltung</a>
                    </>
                  )}
                </td>
              </tr>
            )}
            {visibleDays.map((day, index) => {
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
                (index === 0 || visibleDays[index - 1].month !== day.month) && (
                  <tr className="month" key={`m-${day.month}`} id={`m-${day.month}`}>
                    <th colSpan={columns}>
                      {MONTHS[day.month]} {year}
                    </th>
                  </tr>
                ),
                <tr className={className} key={day.iso} id={`d-${day.iso}`}>
                  <th className="col-date" scope="row">
                    {day.weekday} {String(day.dayOfMonth).padStart(2, '0')}.{String(day.month + 1).padStart(2, '0')}.
                  </th>
                  <td className="col-holiday">{holiday}</td>
                  {plan.employees.map((employee) => {
                    const entries = entriesByCell.get(cellKey(employee.id, day.iso)) ?? []
                    const chips = entries.map((entry) => (
                      <Chip key={entry.id} entry={entry} dimmed={needle !== '' && !matches(entry)} />
                    ))
                    return (
                      <td key={employee.id}>
                        {canEdit ? (
                          <button
                            type="button"
                            className="cell"
                            onClick={() => setEditing({ employee, date: day.iso })}
                            aria-label={`${employee.name}, ${day.weekday} ${day.dayOfMonth}.${day.month + 1}. bearbeiten`}
                          >
                            {chips}
                          </button>
                        ) : (
                          <div className="cell">{chips}</div>
                        )}
                      </td>
                    )
                  })}
                </tr>,
              ]
            })}
          </tbody>
        </table>
      </div>

      {dialog}

    </div>
  )
}

function scrollToRow(id: string) {
  document.getElementById(id)?.scrollIntoView({ block: 'start' })
}
