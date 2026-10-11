import { useEffect, useRef } from 'react'
import type { Entry, NamedItem } from '../api/types'
import { formatDateLong } from '../lib/dates'
import { Chip } from './Chip'

interface Props {
  employee: NamedItem
  date: string
  entries: Entry[]
  holiday?: string
  onClose: () => void
}

/** Read-only view of one employee's day, for everybody who may not change the plan. */
export function DayDetails({ employee, date, entries, holiday, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialog.current?.showModal?.()
  }, [])

  return (
    <dialog ref={dialog} onClose={onClose} className="day-details">
      <h2>{employee.name}</h2>
      <p className="muted">
        {formatDateLong(date)}
        {holiday && <span className="badge-holiday">{holiday}</span>}
      </p>
      {entries.length === 0 ? (
        <p>Nicht eingeplant.</p>
      ) : (
        <div className="day-details-entries">
          {entries.map((entry) => (
            <Chip key={entry.id} entry={entry} />
          ))}
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Schließen
        </button>
      </div>
    </dialog>
  )
}
