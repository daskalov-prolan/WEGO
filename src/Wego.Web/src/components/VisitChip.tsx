import type { MouseEvent } from 'react'
import type { Entry } from '../api/types'
import { entryStyle } from '../lib/activities'
import { customers, VISIT, visitGroup, visitTime } from '../lib/visitGroup'
import { ActivityIcon } from './ActivityIcon'

const hm = (time: string | null) => time?.slice(0, 5) ?? ''

/**
 * The visits of an employee on a day as one card in the plan: a band "Besichtigung" in the colour of the activity,
 * below on white how many customers and when, and their names (a click on a name opens the enquiry).
 */
export function VisitChip({
  entries,
  dimmed = false,
  onSiteClick,
}: {
  /** The entries of the visits of the day (customers and the day set aside). */
  entries: Entry[]
  dimmed?: boolean
  onSiteClick?: (siteId: number, event: MouseEvent) => void
}) {
  const group = visitGroup(entries)
  if (!group) return null
  const time = visitTime(group)
  const title = [
    `Besichtigung · ${customers(group.visits.length)}${time ? ` · ${time}` : ''}`,
    ...group.visits.map((visit) => `${hm(visit.startTime)} ${visit.siteName ?? ''}`),
  ].join('\n')
  return (
    <span
      className={dimmed ? 'chip chip-visit dimmed' : 'chip chip-visit'}
      style={entryStyle({ type: 'Baustelle', activity: VISIT })}
      title={title}
      data-entry-id={group.window?.id ?? group.visits[0]?.id}
    >
      <span className="visit-band">
        <ActivityIcon activity={VISIT} size={12} /> Besichtigung
      </span>
      <span className="visit-body">
        <span className="visit-count">{customers(group.visits.length)}</span>
        {time && <span className="time">{time}</span>}
        {group.visits.length > 0 && (
          <span className="visit-who">
            {group.visits.map((visit, index) => (
              <span key={visit.id}>
                {index > 0 && ' · '}
                {onSiteClick && visit.siteId !== null ? (
                  <span className="site-link" role="link" onClick={(event) => onSiteClick(visit.siteId!, event)}>
                    {visit.siteName}
                  </span>
                ) : (
                  visit.siteName
                )}
              </span>
            ))}
          </span>
        )}
      </span>
    </span>
  )
}
