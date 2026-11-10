import type { MouseEvent, PointerEvent } from 'react'
import type { Entry } from '../api/types'
import { activityLabel, serviceName, tentativeName, entryName, entryStyle, entryTitle, isFree } from '../lib/activities'
import { ServiceIcon } from './ServiceIcon'
import { dragSource } from '../lib/dragPlan'
import { formatTimeRange, WHOLE_DAY } from '../lib/dates'

interface Props {
  entry: Entry
  dimmed?: boolean
  withActivity?: boolean
  /** Makes the site name clickable, e.g. to open the record of the site. */
  onSiteClick?: (siteId: number, event: MouseEvent) => void
  /** Shown instead of the site name, e.g. the employee in the plan by site. */
  label?: string
  /** Planners can drag the entry onto another cell of the plan. */
  draggable?: boolean
  /** Handlers to take something dropped on this entry (e.g. an activity from above the plan). */
  drop?: Record<string, unknown>
  /** Marked by a click: framed. */
  marked?: boolean
  /** An entry of the site searched for in the plan. */
  found?: boolean
  /** A reserved day of an offer site (see isReservation): framed in black on white. */
  reserved?: boolean
  /** Ends of a marked stretch: dragging them makes it longer or shorter. */
  stretch?: { left: boolean; right: boolean; down?: boolean; onStart: (side: 'left' | 'right' | 'down', event: PointerEvent) => void }
}

/** Sign for a note inside an entry: a small sheet, or a red "!" for a very important note; pointing at the entry shows the note. */
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
/** The name of a site; a service call with the sign of a wrench in place of "SE:". */
export function SiteName({ name }: { name: string }) {
  const tentative = tentativeName(name)
  if (tentative !== null)
    return (
      <>
        <span className="tentative-mark" aria-label="unbestätigt">
          ?
        </span>
        {tentative}
      </>
    )
  const service = serviceName(name)
  if (service === null) return <>{name}</>
  return (
    <>
      <ServiceIcon />
      {service}
    </>
  )
}

export function Chip({ entry, dimmed = false, withActivity = false, onSiteClick, label, draggable = false, marked = false, found = false, reserved = false, stretch, drop }: Props) {
  // The whole working day goes without saying: only part of a day shows its time.
  const time = entry.startTime?.startsWith(WHOLE_DAY.start) && entry.endTime?.startsWith(WHOLE_DAY.end) ? '' : formatTimeRange(entry)
  // An appointment not confirmed yet: without colour, framed in dashes.
  const tentative = entry.type === 'Baustelle' && tentativeName(entry.siteName ?? '') !== null
  const className = ['chip', `chip-${entry.type.toLowerCase()}`, dimmed ? 'dimmed' : '', reserved ? 'reserved' : '', tentative ? 'tentative' : '']
    .filter(Boolean)
    .join(' ')
  const siteId = entry.siteId
  return (
    <span
      className={[className, draggable ? 'drag-source' : '', marked ? 'marked' : '', found ? 'found' : ''].filter(Boolean).join(' ')}
      style={entryStyle(entry)}
      // With a note, pointing at the entry shows the note instead of site and activity.
      title={entry.note ? `${entry.noteImportant ? 'WICHTIG: ' : ''}${entry.note}` : reserved ? `${entry.siteName}: reserviert (Angebot, noch kein Baubeginn)` : entryTitle(entry)}
      data-entry-id={entry.id}
      {...dragSource({ kind: 'entry', entry }, draggable)}
      {...drop}
    >
      <span className="chip-line">
        {time && <span className="time">{time}</span>}
        <span className="chip-name">
          {label !== undefined ? (
            label
          ) : entry.type !== 'Baustelle' ? (
            entry.type
          ) : onSiteClick && siteId !== null ? (
            <span className="site-link" role="link" onClick={(event) => onSiteClick(siteId, event)}>
              <SiteName name={entry.siteName ?? ''} />
            </span>
          ) : (
            <SiteName name={entryName(entry)} />
          )}
        </span>
        {entry.note && <NoteMark important={entry.noteImportant} />}
      </span>
      {withActivity && entry.activity && !isFree(entry) && <span className="activity">{activityLabel(entry.activity)}</span>}
      {stretch?.left && (
        <span className="stretch-handle left" title="Ziehen: früher beginnen oder später" onPointerDown={(event) => stretch.onStart('left', event)} />
      )}
      {stretch?.down && (
        <span
          className="stretch-handle down"
          title="Nach unten ziehen: für die Mitarbeiter darunter übernehmen"
          onPointerDown={(event) => stretch.onStart('down', event)}
        />
      )}
      {stretch?.right && (
        <span className="stretch-handle right" title="Ziehen: länger oder kürzer" onPointerDown={(event) => stretch.onStart('right', event)} />
      )}
      {entry.note && (
        <span className={entry.noteImportant ? 'note important' : 'note'}>
          {entry.noteImportant && <strong className="important-mark">! </strong>}
          {entry.note}
        </span>
      )}
    </span>
  )
}