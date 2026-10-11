import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api/client'
import type { DayEntryInput, Entry, EntryType, NamedItem } from '../api/types'
import { daysBetween, formatDate } from '../lib/dates'

interface Props {
  employee: NamedItem
  date: string
  entries: Entry[]
  customers: NamedItem[]
  onClose: () => void
  onSaved: () => void
}

interface Row {
  type: EntryType
  customerName: string
  start: string
  end: string
  note: string
}

const emptyRow = (type: EntryType): Row => ({ type, customerName: '', start: '', end: '', note: '' })

/** Edits all entries of one employee on one day. Several rows with time windows make a split day. */
export function DayDialog({ employee, date, entries, customers, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [rows, setRows] = useState<Row[]>(() =>
    entries.length === 0
      ? [emptyRow('Baustelle')]
      : entries.map((e) => ({
          type: e.type,
          customerName: e.customerName ?? '',
          start: e.startTime?.slice(0, 5) ?? '',
          end: e.endTime?.slice(0, 5) ?? '',
          note: e.note ?? '',
        })),
  )
  const [until, setUntil] = useState(date)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    dialog.current?.showModal?.()
  }, [])

  const update = (index: number, change: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const inputs: DayEntryInput[] = rows.map((row) => ({
      type: row.type,
      customerName: row.type === 'Baustelle' ? row.customerName : null,
      startTime: row.start ? `${row.start}:00` : null,
      endTime: row.end ? `${row.end}:00` : null,
      note: row.note.trim() || null,
    }))

    // A range (for example two weeks of vacation) is applied to working days only.
    const days = until > date ? daysBetween(date, until).filter((day) => !day.isWeekend) : [{ iso: date }]

    setBusy(true)
    setError('')
    try {
      for (const day of days) {
        await api.saveDay(employee.id, day.iso, inputs)
      }
      onSaved()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialog} onClose={onClose}>
      <form onSubmit={submit}>
        <h2>
          {employee.name} · {formatDate(date)}
        </h2>

        {rows.length === 0 && <p className="muted">Keine Einträge. Speichern leert diesen Tag.</p>}

        {rows.map((row, index) => (
          <div className="entry-row" key={index}>
            <label className="field">
              Art
              <select value={row.type} onChange={(e) => update(index, { type: e.target.value as EntryType })}>
                <option>Baustelle</option>
                <option>Urlaub</option>
                <option>Krank</option>
              </select>
            </label>
            <label className="field">
              Kunde
              <input
                list="customer-names"
                value={row.type === 'Baustelle' ? row.customerName : ''}
                onChange={(e) => update(index, { customerName: e.target.value })}
                disabled={row.type !== 'Baustelle'}
                required={row.type === 'Baustelle'}
                maxLength={200}
                autoFocus={index === 0 && entries.length === 0}
              />
            </label>
            <label className="field">
              von
              <input type="time" value={row.start} onChange={(e) => update(index, { start: e.target.value })} />
            </label>
            <label className="field">
              bis
              <input type="time" value={row.end} onChange={(e) => update(index, { end: e.target.value })} />
            </label>
            <label className="field">
              Notiz
              <input
                value={row.note}
                onChange={(e) => update(index, { note: e.target.value })}
                maxLength={500}
                placeholder="z. B. mit 2 Helfern"
              />
            </label>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              aria-label={`Eintrag ${index + 1} entfernen`}
            >
              ✕
            </button>
          </div>
        ))}

        <datalist id="customer-names">
          {customers.map((customer) => (
            <option key={customer.id} value={customer.name} />
          ))}
        </datalist>

        <div className="dialog-actions">
          <button type="button" className="btn btn-small" onClick={() => setRows([...rows, emptyRow('Baustelle')])}>
            + Baustelle
          </button>
          <button type="button" className="btn btn-small" onClick={() => setRows([emptyRow('Urlaub')])}>
            Urlaub
          </button>
          <button type="button" className="btn btn-small" onClick={() => setRows([emptyRow('Krank')])}>
            Krank
          </button>
          <button type="button" className="btn btn-small" onClick={() => setRows([])}>
            Tag leeren
          </button>
        </div>

        <div className="toolbar" style={{ marginTop: 16 }}>
          <label className="field">
            Übernehmen bis einschließlich
            <input type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value || date)} />
          </label>
          {until > date && (
            <span className="muted">
              Ersetzt die Einträge aller Arbeitstage (Mo–Fr) bis {formatDate(until)}.
            </span>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Speichern
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </form>
    </dialog>
  )
}
