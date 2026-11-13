import type { MouseEvent } from 'react'
import type { Entry } from '../api/types'
import { entryStyle } from '../lib/activities'
import { customers, VISIT, visitGroup, visitTime } from '../lib/visitGroup'
import { ActivityIcon } from './ActivityIcon'

const hm = (time: string | null) => time?.slice(0, 5) ?? ''

/**
 * The visits of an employee on a day as one card in the plan, as small as the others: filled in the colour of
 * Besichtigung, the magnifier in front, the number of customers in a white circle behind. Time and customers are
 * in the tooltip; with one customer a click on the name opens the enquiry.
 */
export function VisitChip({
  entries,
  onSiteClick,
}: {
  /** The entries of the visits of the day (customers and the day set aside). */
  entries: Entry[]
  onSiteClick?: (siteId: number, event: MouseEvent) => void
}) {
  const group = visitGroup(entries)
  if (!group) return null
  const time = visitTime(group)
  const title = [
    `Besichtigung · ${customers(group.visits.length)}${time ? ` · ${time}` : ''}`,
    ...group.visits.map((visit) => `${hm(visit.startTime)} ${visit.siteName ?? ''}`),
  ].join('\n')
  const only = group.visits.length === 1 ? group.visits[0] : undefined
  return (
    <span
      className="chip chip-baustelle chip-visit"
      style={entryStyle({ type: 'Baustelle', activity: VISIT })}
      title={title}
      data-entry-id={group.window?.id ?? group.visits[0]?.id}
    >
      <span className="chip-line">
        <span className="chip-name">
          <ActivityIcon activity={VISIT} size={12} />{' '}
          {onSiteClick && only?.siteId != null ? (
            <span className="site-link" role="link" onClick={(event) => onSiteClick(only.siteId!, event)}>
              Besichtigung
            </span>
          ) : (
            'Besichtigung'
          )}
        </span>
        {group.visits.length > 0 && (
          <span className="visit-badge" aria-label={customers(group.visits.length)}>
            {group.visits.length}
          </span>
        )}
      </span>
      {time && <span className="time">{time}</span>}
    </span>
  )
}
