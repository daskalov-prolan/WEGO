import type { Entry, Site } from '../api/types'
import { activitiesOfStatus, activityLabel } from './activities'

/** One step of the offer phase on a site: done (its day has come), planned (a day ahead) or still open. */
export interface OfferStep {
  activity: string
  label: string
  state: 'done' | 'planned' | 'open'
  /** yyyy-MM-dd: the day it was done (the last) or is planned (the next). */
  date: string | null
}

/** A site with no step done or planned for so long waits: it is marked. */
export const WAITING_DAYS = 14

/**
 * The steps of the offer phase of a site, in their fixed order: the enquiry (Anfrage) by the day it came in, the
 * others (Besichtigung, Objektauswahl, Angebotsübergabe) by the entries of the plan with that activity.
 */
export function offerSteps(site: Site, entries: Entry[], today: string): OfferStep[] {
  return activitiesOfStatus('Angebot').map((activity) => {
    const label = activityLabel(activity) ?? activity
    if (activity === 'Anfrage') {
      const date = site.requestedOn ?? null
      return { activity, label, state: date && date <= today ? 'done' : 'open', date }
    }
    const days = entries.filter((entry) => entry.siteId === site.id && entry.activity === activity).map((entry) => entry.date)
    const past = days.filter((day) => day <= today).sort()
    const ahead = days.filter((day) => day > today).sort()
    if (ahead.length > 0) return { activity, label, state: 'planned', date: ahead[0] }
    if (past.length > 0) return { activity, label, state: 'done', date: past[past.length - 1] }
    return { activity, label, state: 'open', date: null }
  })
}

/**
 * Days the site has been waiting: since the last step done, when nothing is planned and the offer is not handed
 * over yet. Null: it is not waiting (something planned, handed over, or less than WAITING_DAYS).
 */
export function waitingDays(steps: OfferStep[], today: string): number | null {
  if (steps.some((step) => step.state === 'planned')) return null
  if (steps.at(-1)?.state === 'done') return null
  const last = steps.filter((step) => step.state === 'done' && step.date).map((step) => step.date!).sort().at(-1)
  if (!last) return null
  const days = Math.round((Date.parse(today) - Date.parse(last)) / 86400000)
  return days >= WAITING_DAYS ? days : null
}
