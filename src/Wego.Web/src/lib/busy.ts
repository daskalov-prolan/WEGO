import type { Entry, MeetingWeek, OwnBusy } from '../api/types'

/** "08:30:00" as minutes; no time: the whole day. */
const minutes = (time: string | null, whole: number) => {
  if (!time) return whole
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Two times of a day overlap; without times something takes the whole day. */
export function overlaps(a: { startTime: string | null; endTime: string | null }, b: { startTime: string | null; endTime: string | null }) {
  return minutes(a.startTime, 0) < minutes(b.endTime, 24 * 60) && minutes(b.startTime, 0) < minutes(a.endTime, 24 * 60)
}

/** "9:00–10:30", or "ganztägig". */
export const busyTime = (busy: OwnBusy) =>
  busy.startTime && busy.endTime ? `${busy.startTime.slice(0, 5)}–${busy.endTime.slice(0, 5)}` : 'ganztägig'

/** The sites and offer steps of his day at the time of a meeting (not vacation, not time kept free). */
export function meetingClashes(week: MeetingWeek, entries: Entry[]): string[] {
  const at = { startTime: week.startTime, endTime: week.endTime }
  return entries
    .filter((entry) => entry.type === 'Baustelle' && !(entry.siteId === null && entry.activity === null) && overlaps(at, entry))
    .map((entry) => entry.siteName ?? entry.activity ?? 'Eintrag')
}

/** What is planned for him at a busy time: entries (not time kept free) and meetings. */
export function clashes(busy: OwnBusy, entries: Entry[], meetings: MeetingWeek[]): string[] {
  const names: string[] = []
  for (const entry of entries) {
    // Away anyway (vacation, sick), or time kept free: nothing in the way.
    if (entry.type !== 'Baustelle' || (entry.siteId === null && entry.activity === null)) continue
    if (overlaps(busy, entry)) names.push(entry.siteName ?? entry.activity ?? 'Eintrag')
  }
  for (const week of meetings) if (overlaps(busy, week)) names.push(week.title)
  return names
}

/** An entry of work (a site or a step of the offer) with a time window: what can be in the way of another. */
type Timed = { type: string; siteId: number | null; activity: string | null; startTime: string | null; endTime: string | null }
const timedWork = (entry: Timed) => entry.type === 'Baustelle' && !(entry.siteId === null && entry.activity === null) && !!entry.startTime && !!entry.endTime

/**
 * The entries of a day without the time kept free ("verfügbar") that something else took since: a site, a
 * service call asked of the craftsman, an appointment not confirmed yet, Urlaub or Krank at that time. Nothing
 * but time kept free (the rest of the day deleted): the day is empty, white like any free day.
 */
export function withoutCoveredFree<T extends Timed>(entries: T[]): T[] {
  const keptFree = (entry: T) => entry.type === 'Baustelle' && entry.siteId === null && entry.activity === null
  if (!entries.some(keptFree)) return entries
  const others = entries.filter((entry) => !keptFree(entry))
  if (others.length === 0) return []
  const left = entries.filter((entry) => !keptFree(entry) || !others.some((other) => overlaps(entry, other)))
  return left.length === entries.length ? entries : left
}

/** Two entries of one day planned at the same time: both are in the way of each other. */
export function overlapping<T extends Timed>(entries: T[]): T[] {
  const timed = entries.filter(timedWork)
  return timed.filter((entry) => timed.some((other) => other !== entry && overlaps(entry, other)))
}
