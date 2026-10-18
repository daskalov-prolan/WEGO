import type { MouseEvent } from 'react'
import type { Entry } from '../api/types'
import { activityLabel, entryStyle, entryTitle } from '../lib/activities'
import { formatTimeRange } from '../lib/dates'

interface Props {
  entry: Entry
  dimmed?: boolean
  withActivity?: boolean
  /** Makes the site name clickable, e.g. to open the record of the site. */
  onSiteClick?: (siteId: number, event: MouseEvent) => void
}

/** One plan entry in the colour of its activity: site, time window and note, or Urlaub / Krank. */
export function Chip({ entry, dimmed = false, withActivity = false, onSiteClick }: Props) {
  const time = formatTimeRange(entry)
  const className = ['chip', `chip-${entry.type.toLowerCase()}`, dimmed ? 'dimmed' : ''].filter(Boolean).join(' ')
  const siteId = entry.siteId
  return (
    <span className={className} style={entryStyle(entry)} title={entryTitle(entry)}>
      {time && <span className="time">{time}</span>}
      {entry.type !== 'Baustelle' ? (
        entry.type
      ) : onSiteClick && siteId !== null ? (
        <span className="site-link" role="link" onClick={(event) => onSiteClick(siteId, event)}>
          {entry.siteName}
        </span>
      ) : (
        entry.siteName
      )}
      {withActivity && entry.activity && <span className="activity">{activityLabel(entry.activity)}</span>}
      {entry.note && <span className="note">{entry.note}</span>}
    </span>
  )
}