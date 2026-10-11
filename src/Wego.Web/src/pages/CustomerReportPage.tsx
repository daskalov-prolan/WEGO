import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { CustomerReport, NamedItem } from '../api/types'
import { formatDate, formatHours, formatTimeRange } from '../lib/dates'

interface Props {
  year: number
  customerId: number | null
}

/** How many days were worked on one construction site, and by whom. */
export function CustomerReportPage({ year, customerId }: Props) {
  const [customers, setCustomers] = useState<NamedItem[]>([])
  const [report, setReport] = useState<CustomerReport | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.customers().then(setCustomers, (e) => setError(messageOf(e)))
  }, [])

  useEffect(() => {
    if (customerId === null) return
    api.customerReport(customerId, year).then(setReport, (e) => setError(messageOf(e)))
  }, [customerId, year])

  return (
    <div className="page">
      <h1>Auswertung nach Baustelle</h1>

      <div className="toolbar">
        <label className="field">
          Baustelle (Kunde)
          <select
            value={customerId ?? ''}
            onChange={(e) => (window.location.hash = `#/baustellen/${e.target.value}`)}
          >
            <option value="">Bitte wählen</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      {report && report.customerId === customerId && report.year === year && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="value">{report.totalDays}</div>
              <div className="label">Einsatztage {report.year}</div>
            </div>
            <div className="stat">
              <div className="value">{report.employees.length}</div>
              <div className="label">Mitarbeiter</div>
            </div>
            <div className="stat">
              <div className="value">{formatHours(report.totalHours)}</div>
              <div className="label">Stunden laut Zeitfenstern</div>
            </div>
          </div>
          <p className="muted">
            Ein Einsatztag ist ein Tag, an dem ein Mitarbeiter auf dieser Baustelle eingeplant war, auch bei
            geteilten Tagen. Stunden werden nur aus Einträgen mit Zeitfenster berechnet.
          </p>

          <h2>Nach Mitarbeiter</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th className="num">Einsatztage</th>
                <th className="num">Stunden</th>
              </tr>
            </thead>
            <tbody>
              {report.employees.map((row) => (
                <tr key={row.id}>
                  <td>
                    <a href={`#/mitarbeiter/${row.id}`}>{row.name}</a>
                  </td>
                  <td className="num">{row.days}</td>
                  <td className="num">{formatHours(row.hours)}</td>
                </tr>
              ))}
              {report.employees.length === 0 && (
                <tr>
                  <td colSpan={3}>Keine Einsätze in {report.year}.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>Summe</td>
                <td className="num">{report.totalDays}</td>
                <td className="num">{formatHours(report.totalHours)}</td>
              </tr>
            </tfoot>
          </table>

          <h2>Alle Einsätze</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Mitarbeiter</th>
                <th>Zeitfenster</th>
              </tr>
            </thead>
            <tbody>
              {report.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.date)}</td>
                  <td>{entry.employeeName}</td>
                  <td>{formatTimeRange(entry) || 'ganztägig'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
