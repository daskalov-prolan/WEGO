import type { Entry } from '../api/types'
import { formatTimeRange } from '../lib/dates'
import { siteStyle } from '../lib/ui'

/** One plan entry: a construction site in its own colour, with time window and note, or Urlaub / Krank. */
export function Chip({ entry, dimmed = false }: { entry: Entry; dimmed?: boolean }) {
  const time = formatTimeRange(entry)
  const className = ['chip', `chip-${entry.type.toLowerCase()}`, dimmed ? 'dimmed' : ''].filter(Boolean).join(' ')
  return (
    <span className={className} style={entry.type === 'Baustelle' ? siteStyle(entry.customerId) : undefined}>
      {time && <span className="time">{time}</span>}
      {entry.type === 'Baustelle' ? entry.customerName : entry.type}
      {entry.note && <span className="note">{entry.note}</span>}
    </span>
  )
}
