import type { Entry } from '../api/types'
import { formatTimeRange } from '../lib/dates'
import { activityLabel, entryStyle, entryTitle } from '../lib/activities'

/** One plan entry in the colour of its activity: site, time window and note, or Urlaub / Krank. */
export function Chip({ entry, dimmed = false, withActivity = false }: { entry: Entry; dimmed?: boolean; withActivity?: boolean }) {
  const time = formatTimeRange(entry)
  const className = ['chip', `chip-${entry.type.toLowerCase()}`, dimmed ? 'dimmed' : ''].filter(Boolean).join(' ')
  return (
    <span className={className} style={entryStyle(entry)} title={entryTitle(entry)}>
      {time && <span className="time">{time}</span>}
      {entry.type === 'Baustelle' ? entry.customerName : entry.type}
      {withActivity && entry.activity && <span className="activity">{activityLabel(entry.activity)}</span>}
      {entry.note && <span className="note">{entry.note}</span>}
    </span>
  )
}
