import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api/client'
import type { Employee, EmployeeInput, NamedItem, Role, SchoolHoliday } from '../api/types'
import { formatDate } from '../lib/dates'

/** Planner-only: employees and their rights, school holidays, customer names. */
export function AdminPage({ year }: { year: number }) {
  return (
    <div className="page">
      <h1>Verwaltung</h1>
      <EmployeesSection />
      <SchoolHolidaysSection year={year} />
      <CustomersSection />
    </div>
  )
}

const newEmployee: EmployeeInput = {
  name: '',
  sortOrder: 0,
  isActive: true,
  showInPlan: true,
  vacationDaysPerYear: 30,
  userName: null,
  role: 'Mitarbeiter',
  password: null,
}

function EmployeesSection() {
  const [employees, setEmployees] = useState<Employee[]>([])
  // id 0 = new employee
  const [editing, setEditing] = useState<{ id: number; input: EmployeeInput } | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.employees().then(setEmployees, (e) => setError(messageOf(e)))
  }, [])
  useEffect(load, [load])

  const change = (patch: Partial<EmployeeInput>) =>
    setEditing((current) => current && { ...current, input: { ...current.input, ...patch } })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    try {
      if (editing.id === 0) await api.createEmployee(editing.input)
      else await api.updateEmployee(editing.id, editing.input)
      setEditing(null)
      setError('')
      load()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <>
      <h2>Mitarbeiter und Zugriffsrechte</h2>
      <p className="muted">
        Planer dürfen die Planung ändern und sehen alle Urlaubskonten. Mitarbeiter dürfen den Plan nur lesen und
        sehen nur ihr eigenes Urlaubskonto.
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Benutzername</th>
            <th>Rolle</th>
            <th className="num">Urlaubstage</th>
            <th className="num">Reihenfolge</th>
            <th>Im Plan</th>
            <th>Aktiv</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => (
            <tr key={employee.id}>
              <td>{employee.name}</td>
              <td>{employee.userName ?? <span className="muted">keine Anmeldung</span>}</td>
              <td>{employee.role}</td>
              <td className="num">{employee.vacationDaysPerYear}</td>
              <td className="num">{employee.sortOrder}</td>
              <td>{employee.showInPlan ? 'ja' : 'nein'}</td>
              <td>{employee.isActive ? 'ja' : 'nein'}</td>
              <td>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() =>
                    setEditing({
                      id: employee.id,
                      input: {
                        name: employee.name,
                        sortOrder: employee.sortOrder,
                        isActive: employee.isActive,
                        showInPlan: employee.showInPlan,
                        vacationDaysPerYear: employee.vacationDaysPerYear,
                        userName: employee.userName,
                        role: employee.role,
                        password: null,
                      },
                    })
                  }
                >
                  Bearbeiten
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {error && <p className="error">{error}</p>}

      {editing ? (
        <form className="panel" onSubmit={submit} style={{ marginTop: 12 }}>
          <div className="toolbar">
            <label className="field">
              Name
              <input value={editing.input.name} onChange={(e) => change({ name: e.target.value })} required />
            </label>
            <label className="field">
              Benutzername (leer = keine Anmeldung)
              <input
                value={editing.input.userName ?? ''}
                onChange={(e) => change({ userName: e.target.value || null })}
                autoComplete="off"
              />
            </label>
            <label className="field">
              {editing.id === 0 ? 'Passwort' : 'Neues Passwort (leer = unverändert)'}
              <input
                type="password"
                value={editing.input.password ?? ''}
                onChange={(e) => change({ password: e.target.value || null })}
                minLength={8}
                autoComplete="new-password"
              />
            </label>
            <label className="field">
              Rolle
              <select value={editing.input.role} onChange={(e) => change({ role: e.target.value as Role })}>
                <option>Mitarbeiter</option>
                <option>Planer</option>
              </select>
            </label>
            <label className="field">
              Urlaubstage pro Jahr
              <input
                type="number"
                min={0}
                max={366}
                value={editing.input.vacationDaysPerYear}
                onChange={(e) => change({ vacationDaysPerYear: Number(e.target.value) })}
                style={{ width: 90 }}
              />
            </label>
            <label className="field">
              Reihenfolge im Plan
              <input
                type="number"
                value={editing.input.sortOrder}
                onChange={(e) => change({ sortOrder: Number(e.target.value) })}
                style={{ width: 90 }}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={editing.input.showInPlan}
                onChange={(e) => change({ showInPlan: e.target.checked })}
              />
              Spalte im Einsatzplan
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={editing.input.isActive}
                onChange={(e) => change({ isActive: e.target.checked })}
              />
              Aktiv
            </label>
          </div>
          <div className="dialog-actions">
            <button type="submit" className="btn btn-primary">
              Speichern
            </button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <p>
          <button type="button" className="btn" onClick={() => setEditing({ id: 0, input: newEmployee })}>
            + Mitarbeiter anlegen
          </button>
        </p>
      )}
    </>
  )
}

function SchoolHolidaysSection({ year }: { year: number }) {
  const [holidays, setHolidays] = useState<SchoolHoliday[]>([])
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.plan(year).then((plan) => setHolidays(plan.schoolHolidays), (e) => setError(messageOf(e)))
  }, [year])
  useEffect(load, [load])

  const run = async (action: () => Promise<string>) => {
    setError('')
    setMessage('')
    try {
      setMessage(await action())
      load()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  const add = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      await api.addSchoolHoliday(name, startDate, endDate)
      setName('')
      setStartDate('')
      setEndDate('')
      return ''
    })
  }

  return (
    <>
      <h2>Schulferien Berlin {year}</h2>
      <p>
        <button
          type="button"
          className="btn"
          onClick={() =>
            run(async () => {
              const result = await api.importSchoolHolidays(year)
              return `${result.imported} von ${result.total} Ferienzeiträumen neu übernommen.`
            })
          }
        >
          Ferien {year} automatisch abrufen
        </button>{' '}
        <span className="muted">Quelle: openholidaysapi.org</span>
      </p>
      {message && <p>{message}</p>}
      {error && <p className="error">{error}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Bezeichnung</th>
            <th>Von</th>
            <th>Bis</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {holidays.map((holiday) => (
            <tr key={holiday.id}>
              <td>{holiday.name}</td>
              <td>{formatDate(holiday.startDate)}</td>
              <td>{formatDate(holiday.endDate)}</td>
              <td>
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  onClick={() =>
                    run(async () => {
                      await api.deleteSchoolHoliday(holiday.id)
                      return ''
                    })
                  }
                >
                  Löschen
                </button>
              </td>
            </tr>
          ))}
          {holidays.length === 0 && (
            <tr>
              <td colSpan={4}>Für {year} sind noch keine Schulferien eingetragen.</td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="toolbar" onSubmit={add} style={{ marginTop: 12 }}>
        <label className="field">
          Bezeichnung
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          Von
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label className="field">
          Bis
          <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
        </label>
        <button type="submit" className="btn">
          Hinzufügen
        </button>
      </form>
    </>
  )
}

function CustomersSection() {
  const [customers, setCustomers] = useState<NamedItem[]>([])
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.customers().then(setCustomers, (e) => setError(messageOf(e)))
  }, [])
  useEffect(load, [load])

  const rename = async (customer: NamedItem) => {
    const name = window.prompt(
      'Neuer Name. Gibt es den Namen schon, werden beide Baustellen zusammengeführt.',
      customer.name,
    )
    if (!name || name.trim() === customer.name) return
    try {
      await api.renameCustomer(customer.id, name)
      setError('')
      load()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <>
      <h2>Baustellen (Kunden)</h2>
      <p className="muted">
        Baustellen entstehen beim Eintragen im Einsatzplan. Hier lassen sich Schreibfehler korrigieren und doppelte
        Namen zusammenführen.
      </p>
      {error && <p className="error">{error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Kunde</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {customers.map((customer) => (
            <tr key={customer.id}>
              <td>
                <a href={`#/baustellen/${customer.id}`}>{customer.name}</a>
              </td>
              <td>
                <button type="button" className="btn btn-small" onClick={() => rename(customer)}>
                  Umbenennen
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
