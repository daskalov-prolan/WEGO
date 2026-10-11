import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { EmployeeReport, NamedItem, User, Vacation } from '../api/types'
import { formatDate, formatHours, formatTimeRange } from '../lib/dates'

interface Props {
  year: number
  user: User
  employeeId: number | null
}

/** Planner-only: where one employee worked during the year, with vacation and sick days. */
export function EmployeeReportPage({ year, user, employeeId }: Props) {
  const [employees, setEmployees] = useState<NamedItem[]>([])
  const [report, setReport] = useState<EmployeeReport | null>(null)
  const [overview, setOverview] = useState<Vacation[]>([])
  const [error, setError] = useState('')

  // Without a selection everybody starts with their own data.
  const selectedId = employeeId ?? user.id

  useEffect(() => {
    api.employeeNames().then(setEmployees, (e) => setError(messageOf(e)))
  }, [])

  useEffect(() => {
    api.employeeReport(selectedId, year).then(setReport, (e) => setError(messageOf(e)))
  }, [selectedId, year])

  useEffect(() => {
    api.vacationOverview(year).then(setOverview, (e) => setError(messageOf(e)))
  }, [year])

  return (
    <div className="page">
      <h1>Auswertung nach Mitarbeiter</h1>

      <div className="toolbar">
        <label className="field">
          Mitarbeiter
          <select value={selectedId} onChange={(e) => (window.location.hash = `#/mitarbeiter/${e.target.value}`)}>
            {!employees.some((employee) => employee.id === selectedId) && (
              <option value={selectedId}>{report?.employeeName ?? ''}</option>
            )}
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      {report && report.employeeId === selectedId && report.year === year && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="value">{report.totalDays}</div>
              <div className="label">Tage auf Baustellen {report.year}</div>
            </div>
            <div className="stat">
              <div className="value">{report.customers.length}</div>
              <div className="label">Baustellen</div>
            </div>
            {
              <>
                <div className="stat">
                  <div className="value">
                    {report.vacation.used} / {report.vacation.entitlement}
                  </div>
                  <div className="label">Urlaubstage verbraucht bzw. eingeplant</div>
                </div>
                <div className={report.vacation.remaining < 0 ? 'stat negative' : 'stat'}>
                  <div className="value">{report.vacation.remaining}</div>
                  <div className="label">Urlaubstage noch verfügbar</div>
                </div>
                <div className="stat">
                  <div className="value">{report.vacation.sickDays}</div>
                  <div className="label">Krankheitstage</div>
                </div>
              </>
            }
          </div>

          <h2>Nach Baustelle</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Baustelle (Kunde)</th>
                <th className="num">Einsatztage</th>
                <th className="num">Stunden</th>
              </tr>
            </thead>
            <tbody>
              {report.customers.map((row) => (
                <tr key={row.id}>
                  <td>
                    <a href={`#/baustellen/${row.id}`}>{row.name}</a>
                  </td>
                  <td className="num">{row.days}</td>
                  <td className="num">{formatHours(row.hours)}</td>
                </tr>
              ))}
              {report.customers.length === 0 && (
                <tr>
                  <td colSpan={3}>Keine Einsätze in {report.year}.</td>
                </tr>
              )}
            </tbody>
          </table>

          <h2>Alle Einsätze</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Baustelle (Kunde)</th>
                <th>Zeitfenster</th>
              </tr>
            </thead>
            <tbody>
              {report.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.date)}</td>
                  <td>{entry.customerName}</td>
                  <td>{formatTimeRange(entry) || 'ganztägig'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {overview.length > 0 && (
        <>
          <h2>Urlaubsübersicht {year}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th className="num">Anspruch</th>
                <th className="num">Verbraucht / eingeplant</th>
                <th className="num">Verfügbar</th>
                <th className="num">Krankheitstage</th>
              </tr>
            </thead>
            <tbody>
              {overview.map((row) => (
                <tr key={row.employeeId}>
                  <td>
                    <a href={`#/mitarbeiter/${row.employeeId}`}>{row.employeeName}</a>
                  </td>
                  <td className="num">{row.entitlement}</td>
                  <td className="num">{row.used}</td>
                  <td className="num">{row.remaining}</td>
                  <td className="num">{row.sickDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
