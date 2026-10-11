import { useState } from 'react'
import type { Entry, NamedItem } from '../api/types'
import { addDays, formatDateLong, todayIso, weekOf } from '../lib/dates'
import { Chip } from './Chip'

interface Props {
  year: number
  employees: NamedItem[]
  entriesOf: (employeeId: number, date: string) => Entry[]
  holidayByDate: Map<string, string>
  canEdit: boolean
  userId?: number
  onEdit: (employee: NamedItem, date: string) => void
}

type Mode = 'day' | 'person'

/**
 * The plan on a phone. Instead of the yearly grid there are two lists, both moved by a week strip:
 * "Tag" shows where everybody is on one day, "Woche" shows one employee from Monday to Sunday.
 */
export function MobilePlan({ year, employees, entriesOf, holidayByDate, canEdit, userId, onEdit }: Props) {
  const first = `${year}-01-01`
  const last = `${year}-12-31`
  const today = todayIso()
  const inYear = (iso: string) => iso >= first && iso <= last

  const ownColumn = employees.find((employee) => employee.id === userId)
  // Whoever has a column of their own most likely wants to know their own week first.
  const [mode, setMode] = useState<Mode>(ownColumn ? 'person' : 'day')
  const [date, setDate] = useState(inYear(today) ? today : first)
  const [employeeId, setEmployeeId] = useState(ownColumn?.id ?? employees[0]?.id)

  const week = weekOf(date)
  const employee = employees.find((e) => e.id === employeeId)
  const go = (iso: string) => setDate(iso < first ? first : iso > last ? last : iso)

  const hasEntries = (iso: string) =>
    mode === 'person' && employee
      ? entriesOf(employee.id, iso).length > 0
      : employees.some((e) => entriesOf(e.id, iso).length > 0)

  return (
    <div className="mplan">
      <div className="mplan-head">
        <div className="segmented" role="tablist" aria-label="Ansicht">
          <button type="button" role="tab" aria-selected={mode === 'day'} onClick={() => setMode('day')}>
            Tag
          </button>
          <button type="button" role="tab" aria-selected={mode === 'person'} onClick={() => setMode('person')}>
            Woche
          </button>
        </div>

        <div className="mplan-nav">
          <button type="button" className="btn" onClick={() => go(addDays(date, -7))} aria-label="Vorherige Woche">
            ‹
          </button>
          <input
            type="date"
            value={date}
            min={first}
            max={last}
            onChange={(e) => e.target.value && go(e.target.value)}
            aria-label="Datum"
          />
          <button type="button" className="btn" onClick={() => go(addDays(date, 7))} aria-label="Nächste Woche">
            ›
          </button>
          {inYear(today) && (
            <button type="button" className="btn" onClick={() => setDate(today)}>
              Heute
            </button>
          )}
        </div>

        <div className="week-strip">
          {week.map((day) => (
            <button
              type="button"
              key={day.iso}
              className={[
                day.iso === date ? 'selected' : '',
                day.iso === today ? 'today' : '',
                day.isWeekend ? 'weekend' : '',
                holidayByDate.has(day.iso) ? 'holiday' : '',
              ].join(' ')}
              disabled={!inYear(day.iso)}
              onClick={() => setDate(day.iso)}
              aria-pressed={day.iso === date}
              aria-label={formatDateLong(day.iso)}
            >
              <span className="wd">{day.weekday}</span>
              <span className="num">{day.dayOfMonth}</span>
              <span className={inYear(day.iso) && hasEntries(day.iso) ? 'dot on' : 'dot'} />
            </button>
          ))}
        </div>

        {mode === 'person' && (
          <select
            className="mplan-employee"
            value={employeeId ?? ''}
            onChange={(e) => setEmployeeId(Number(e.target.value))}
            aria-label="Mitarbeiter"
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mplan-list">
        {employees.length === 0 && <p className="muted">Noch keine Mitarbeiter angelegt.</p>}

        {mode === 'day' && (
          <>
            <h2 className="mplan-title">
              {formatDateLong(date)}
              {holidayByDate.has(date) && <span className="badge-holiday">{holidayByDate.get(date)}</span>}
            </h2>
            {employees.map((e) => (
              <Card
                key={e.id}
                title={e.name}
                entries={entriesOf(e.id, date)}
                onEdit={canEdit ? () => onEdit(e, date) : undefined}
              />
            ))}
          </>
        )}

        {mode === 'person' &&
          employee &&
          week
            .filter((day) => inYear(day.iso))
            .map((day) => (
              <Card
                key={day.iso}
                title={formatDateLong(day.iso)}
                badge={holidayByDate.get(day.iso)}
                highlighted={day.iso === date}
                muted={day.isWeekend}
                entries={entriesOf(employee.id, day.iso)}
                onEdit={canEdit ? () => onEdit(employee, day.iso) : undefined}
              />
            ))}
      </div>
    </div>
  )
}

interface CardProps {
  title: string
  badge?: string
  highlighted?: boolean
  muted?: boolean
  entries: Entry[]
  onEdit?: () => void
}

function Card({ title, badge, highlighted, muted, entries, onEdit }: CardProps) {
  const className = ['mcard', highlighted ? 'highlighted' : '', muted ? 'weekend' : ''].filter(Boolean).join(' ')
  const body = (
    <>
      <span className="mcard-title">
        {title}
        {badge && <span className="badge-holiday">{badge}</span>}
      </span>
      {entries.length === 0 ? (
        <span className="mcard-empty">{muted ? '' : 'nicht eingeplant'}</span>
      ) : (
        entries.map((entry) => <Chip key={entry.id} entry={entry} />)
      )}
    </>
  )

  return onEdit ? (
    <button type="button" className={className} onClick={onEdit} aria-label={`${title} bearbeiten`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  )
}
