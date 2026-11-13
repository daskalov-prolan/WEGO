import type { Entry } from '../api/types'

/** The activity of the visits of enquiries (Besichtigung). */
export const VISIT = 'Besichtigung'

/** The address the days of visits start from and end at. */
export const COMPANY_ADDRESS = 'Alt-Karow 53, 13125 Berlin'

type Timed = Pick<Entry, 'type' | 'activity' | 'siteId' | 'startTime' | 'endTime'>

/** An entry of the visits: a customer visited (with a site) or the day set aside for visits (without). */
export const isVisit = (entry: Pick<Entry, 'type' | 'activity'>) => entry.type === 'Baustelle' && entry.activity === VISIT

export interface VisitGroup<T extends Timed> {
  /** The customers, by time. */
  visits: T[]
  /** The day set aside for visits, when there is one. */
  window: T | undefined
  /** From the first customer to the end of the last; without customers the time set aside. */
  from: string | null
  to: string | null
  /** "Vormittag" or "Nachmittag" when only half the day is set aside. */
  part: 'Vormittag' | 'Nachmittag' | null
}

const hm = (time: string | null) => time?.slice(0, 5) ?? null

/** The visits of a day of an employee taken together, so they show as one card; null without visits. */
export function visitGroup<T extends Timed>(entries: T[]): VisitGroup<T> | null {
  const all = entries.filter(isVisit)
  if (all.length === 0) return null
  const window = all.find((entry) => entry.siteId === null)
  const visits = all.filter((entry) => entry.siteId !== null).sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  const timed = visits.length > 0 ? visits : window ? [window] : []
  const from = timed.map((entry) => hm(entry.startTime)).filter(Boolean).sort()[0] ?? null
  const to = timed.map((entry) => hm(entry.endTime)).filter(Boolean).sort().at(-1) ?? null
  const part = !window?.startTime || !window.endTime ? null
    : window.startTime >= '12:00' ? 'Nachmittag'
      : window.endTime <= '12:30' ? 'Vormittag'
        : null
  return { visits, window, from, to, part }
}

/** The time of the visits: the span of the customers, with the half of the day set aside. */
export function visitTime(group: VisitGroup<Timed>) {
  const span = group.from && group.to ? `${group.from} – ${group.to}` : ''
  return [group.part, span].filter(Boolean).join(' · ')
}

/** How many customers, in words: "1 Kunde", "3 Kunden", or that none are planned yet. */
export const customers = (count: number) => (count === 0 ? 'noch keine Kunden' : count === 1 ? '1 Kunde' : `${count} Kunden`)

/**
 * The entries of a day with the visits as one entry (the day set aside, or else the span of the customers): for
 * telling whether only half of the day is taken.
 */
export function visitsAsOne<T extends Timed>(entries: T[]): T[] {
  const group = visitGroup(entries)
  if (!group) return entries
  const first = entries.find(isVisit)!
  const one = group.window ?? {
    ...first,
    startTime: group.visits[0].startTime,
    endTime: group.visits.map((visit) => visit.endTime ?? '').sort().at(-1) || first.endTime,
  }
  return entries.flatMap((entry) => (entry === first ? [one] : isVisit(entry) ? [] : [entry]))
}
