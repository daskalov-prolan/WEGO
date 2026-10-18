import type { MouseEvent } from 'react'
import type { Entry } from '../api/types'
import { activityLabel, entryStyle, entryTitle } from '../lib/activities'
import { formatTimeRange } from '../lib/dates'
import { ActivityIcon } from './ActivityIcon'

interface Props {
  entry: Entry
  dimmed?: boolean
  withActivity?: boolean
  /** Makes the site name clickable, e.g. to open the record of the site. */
  onSiteClick?: (siteId: number, event: MouseEvent) => void
  /** Shown instead of the site name, e.g. the employee in the plan by site. */
  label?: string
}

/** Sign for a note inside an entry: a small sheet, or a red "!" for a very important note. */
export function NoteMark({ important }: { important: boolean }) {
  return important ? (
    <span className="note-mark important" role="img" aria-label="wichtige Notiz">
      !
    </span>
  ) : (
    <svg className="note-mark" viewBox="0 0 16 16" role="img" aria-label="mit Notiz">
      <path d="M3 1.5h7l3 3v10H3z" fill="#fff" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M5.5 7.5h5M5.5 10h5M5.5 12.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** One plan entry, tinted in the colour of its activity: site, time window and note, or Urlaub / Krank. */
export function Chip({ entry, dimmed = false, withActivity = false, onSiteClick, label }: Props) {
  const time = formatTimeRange(entry)
  const className = ['chip', `chip-${entry.type.toLowerCase()}`, dimmed ? 'dimmed' : ''].filter(Boolean).join(' ')
  const siteId = entry.siteId
  return (
    <span className={className} style={entryStyle(entry)} title={entryTitle(entry)}>
      <span className="chip-line">
        <ActivityIcon activity={entry.activity} type={entry.type} />
        {time && <span className="time">{time}</span>}
        <span className="chip-name">
          {label !== undefined ? (
            label
          ) : entry.type !== 'Baustelle' ? (
            entry.type
          ) : onSiteClick && siteId !== null ? (
            <span className="site-link" role="link" onClick={(event) => onSiteClick(siteId, event)}>
              {entry.siteName}
            </span>
          ) : (
            entry.siteName
          )}
        </span>
        {entry.note && <NoteMark important={entry.noteImportant} />}
      </span>
      {withActivity && entry.activity && <span className="activity">{activityLabel(entry.activity)}</span>}
      {entry.note && (
        <span className={entry.noteImportant ? 'note important' : 'note'}>
          {entry.noteImportant && <strong className="important-mark">! </strong>}
          {entry.note}
        </span>
      )}
    </span>
  )
}