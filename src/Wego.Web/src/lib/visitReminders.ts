import type { VisitEnquiry } from '../api/types'
import { WAITING_DAYS } from './offerSteps'

/** "Kunde wartet auf Terminvereinbarung seit 9 Tagen". */
export const waitingText = (days: number) => `Kunde wartet auf Terminvereinbarung seit ${days} Tagen`

const daysSince = (iso: string, today: string) => Math.round((Date.parse(today) - Date.parse(iso)) / 86_400_000)

/** The customers waiting a week or longer for a visit, the longest first (not those with a no reported). */
export function waitingEnquiries(enquiries: VisitEnquiry[], today: string) {
  return enquiries
    .filter((e) => !e.report && e.requestedOn && daysSince(e.requestedOn, today) >= WAITING_DAYS)
    .map((e) => ({ enquiry: e, days: daysSince(e.requestedOn!, today) }))
    .sort((a, b) => b.days - a.days)
}

/** The days a waiting customer is brought to mind: the 7th, then every second day (9, 11, ...). */
export const remindsToday = (days: number) => days >= WAITING_DAYS && (days - WAITING_DAYS) % 2 === 0
