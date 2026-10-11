import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Entry, NamedItem, Plan } from '../api/types'
import { DayDetails } from '../components/DayDetails'
import { DayDialog } from '../components/DayDialog'
import { MonthMatrix, WeekMatrix } from '../components/PlanMatrix'
import { YearGrid } from '../components/YearGrid'
import {
  addDays,
  addMonths,
  daysBetween,
  daysOfYear,
  isoWeek,
  MONTHS,
  monthOf,
  todayIso,
  weekOf,
} from '../lib/dates'
import { useIsPhone } from '../lib/useIsPhone'

interface Props {
  year: number
  canEdit: boolean
}

type View = 'week' | 'month' | 'year'

const VIEWS: { view: View; label: string }[] = [
  { view: 'week', label: 'Woche' },
  { view: 'month', label: 'Monat' },
  { view: 'year', label: 'Jahr' },
]

const HIDDEN_KEY = 'wego.plan.hiddenEmployees'
const cellKey = (employeeId: number, date: string) => `${employeeId}|${date}`

function loadHidden(): number[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((id) => typeof id === 'number') : []
  } catch {
    return []
  }
}

/**
 * The plan of everybody. The week is the working unit: employees in rows, weekdays in columns, which
 * fits from phone to desktop. Month and year are overviews; the year grid (as in the Excel sheet)
 * is offered on wide screens only.
 */
export function PlanPage({ year, canEdit }: Props) {
  const first = `${year}-01-01`
  const last = `${year}-12-31`
  const today = todayIso()
  const isPhone = useIsPhone()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [chosenView, setChosenView] = useState<View>('week')
  const [anchor, setAnchor] = useState(today >= first && today <= last ? today : first)
  const [filter, setFilter] = useState('')
  const [hidden, setHidden] = useState<number[]>(loadHidden)
  const [open, setOpen] = useState<{ employee: NamedItem; date: string } | null>(null)

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

  const yearDays = useMemo(() => daysOfYear(year), [year])

  const needle = filter.trim().toLowerCase()
  const matches = useCallback(
    (entry: Entry) => needle !== '' && (entry.customerName ?? '').toLowerCase().includes(needle),
    [needle],
  )
  const matchingDates = useMemo(() => {
    if (needle === '' || !plan) return null
    return new Set(plan.entries.filter(matches).map((entry) => entry.date))
  }, [plan, needle, matches])

  if (error) return <p className="error page">{error}</p>
  if (!plan || plan.year !== year) return null

  const view: View = isPhone && chosenView === 'year' ? 'week' : chosenView
  const inYear = (iso: string) => iso >= first && iso <= last
  const go = (iso: string) => setAnchor(iso < first ? first : iso > last ? last : iso)
  const step = (direction: 1 | -1) =>
    go(view === 'month' ? addMonths(anchor, direction) : addDays(anchor, 7 * direction))

  const employees = plan.employees.filter((employee) => !hidden.includes(employee.id))
  const toggleEmployee = (id: number) => {
    const next = hidden.includes(id) ? hidden.filter((other) => other !== id) : [...hidden, id]
    setHidden(next)
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next))
    } catch {
      // Without storage the selection simply lasts until the page is reloaded.
    }
  }

  const entriesOf = (employeeId: number, date: string) => entriesByCell.get(cellKey(employeeId, date)) ?? []
  const isDimmed = (entry: Entry) => needle !== '' && !matches(entry)

  const week = weekOf(anchor).filter((day) => inYear(day.iso))
  const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
  const title =
    view === 'week'
      ? `KW ${isoWeek(anchor)} · ${short(week[0].iso)}–${short(week[week.length - 1].iso)}${year}`
      : view === 'month'
        ? `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${year}`
        : `${year}`

  const filteredCustomer = plan.customers.find((customer) => customer.name.toLowerCase() === needle)
  const shared = {
    employees,
    entriesOf,
    holidayByDate,
    today,
    isDimmed,
    linkNames: canEdit,
    onOpen: (employee: NamedItem, date: string) => setOpen({ employee, date }),
  }

  return (
    <div className="plan">
      <div className="plan-toolbar">
        <div className="plan-toolbar-row">
          <div className="segmented" role="tablist" aria-label="Zeitraum">
            {VIEWS.map((item) => (
              <button
                type="button"
                role="tab"
                key={item.view}
                className={item.view === 'year' ? 'wide-only' : undefined}
                aria-selected={view === item.view}
                onClick={() => setChosenView(item.view)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {view !== 'year' && (
            <div className="plan-stepper">
              <button type="button" className="btn" onClick={() => step(-1)} aria-label="Zurück">
                ‹
              </button>
              <button type="button" className="btn" onClick={() => step(1)} aria-label="Weiter">
                ›
              </button>
            </div>
          )}
          {inYear(today) && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAnchor(today)
                if (view === 'year') document.getElementById(`d-${today}`)?.scrollIntoView({ block: 'start' })
              }}
            >
              Heute
            </button>
          )}
          <strong className="plan-title">{title}</strong>
        </div>

        <div className="plan-toolbar-row">
          <input
            className="plan-filter"
            list="plan-customers"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Baustelle (Kunde) hervorheben"
            type="search"
            aria-label="Nach Baustelle (Kunde) filtern"
          />
          <datalist id="plan-customers">
            {plan.customers.map((customer) => (
              <option key={customer.id} value={customer.name} />
            ))}
          </datalist>

          {view !== 'year' && (
            <input
              type="date"
              value={anchor}
              min={first}
              max={last}
              onChange={(e) => e.target.value && go(e.target.value)}
              aria-label="Datum"
            />
          )}

          <details className="employee-picker">
            <summary>
              Mitarbeiter ({employees.length}/{plan.employees.length})
            </summary>
            <div className="employee-picker-list">
              {plan.employees.map((employee) => (
                <label className="check" key={employee.id}>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(employee.id)}
                    onChange={() => toggleEmployee(employee.id)}
                  />
                  {employee.name}
                </label>
              ))}
            </div>
          </details>

          {matchingDates && (
            <span className="muted">
              {matchingDates.size} {matchingDates.size === 1 ? 'Tag' : 'Tage'} mit Einsätzen in {year}
              {filteredCustomer && canEdit && (
                <>
                  {' · '}
                  <a href={`#/baustellen/${filteredCustomer.id}`}>Auswertung öffnen</a>
                </>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="plan-scroll">
        {plan.employees.length === 0 ? (
          <p className="page">
            Noch keine Mitarbeiter angelegt.
            {canEdit && (
              <>
                {' '}
                <a href="#/verwaltung">Zur Verwaltung</a>
              </>
            )}
          </p>
        ) : view === 'week' ? (
          <WeekMatrix days={week} {...shared} />
        ) : view === 'month' ? (
          <MonthMatrix days={monthOf(anchor)} {...shared} />
        ) : (
          // In the long year grid a filter is only useful if it removes the days without a match.
          <YearGrid
            year={year}
            days={matchingDates ? yearDays.filter((day) => matchingDates.has(day.iso)) : yearDays}
            {...shared}
          />
        )}
      </div>

      {open &&
        (canEdit ? (
          <DayDialog
            key={cellKey(open.employee.id, open.date)}
            employee={open.employee}
            date={open.date}
            entries={entriesOf(open.employee.id, open.date)}
            customers={plan.customers}
            onClose={() => setOpen(null)}
            onSaved={() => {
              setOpen(null)
              load()
            }}
          />
        ) : (
          <DayDetails
            key={cellKey(open.employee.id, open.date)}
            employee={open.employee}
            date={open.date}
            entries={entriesOf(open.employee.id, open.date)}
            holiday={holidayByDate.get(open.date)}
            onClose={() => setOpen(null)}
          />
        ))}
    </div>
  )
}
