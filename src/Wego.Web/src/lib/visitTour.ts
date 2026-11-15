import { driveMin, ON_SITE, roadKm, type Point } from './visitRoute'

/**
 * A tour of visits through a region on a day set aside for them: off from the company at 7:30, an hour at each
 * customer, a lunch break of half an hour starting between 11:30 and 12:30, the last customer done by 16:00. The
 * times are on the quarter hour; the drives are estimated from the places on the map (see visitRoute).
 */

export const DEPART = 7 * 60 + 30
export const LAST_END = 16 * 60
export const LUNCH = 30
export const LUNCH_FROM = 11 * 60 + 30
export const LUNCH_TO = 12 * 60 + 30
/** A customer that would add more driving than this does not lie on the way. */
export const MAX_DETOUR = 25

const quarter = (minutes: number) => Math.ceil(minutes / 15) * 15

/** A customer of the tour; with from, a visit agreed already (it keeps its time). */
export interface TourStop extends Point {
  siteId: number
  from?: number
}

export type TourRow =
  | { kind: 'visit'; siteId: number; start: number; end: number; drive: number; fixed: boolean }
  | { kind: 'lunch'; start: number; end: number }

export interface Tour {
  rows: TourRow[]
  /** The drive back to the company after the last customer. */
  back: number
  /** All the driving of the day. */
  driving: number
  /** The kilometres of it (estimated): between two orders of the same driving time, the shorter wins. */
  km: number
}

/** The times of the stops in this order, or null when they do not fit into the day. */
export function schedule(stops: TourStop[], company: Point): Tour | null {
  const rows: TourRow[] = []
  let time = DEPART
  let at: Point = company
  let lunch = false
  let driving = 0
  let km = 0
  for (const stop of stops) {
    const drive = driveMin(at, stop)
    let start = stop.from ?? quarter(time + drive)
    // The break comes before a customer who would keep one past 12:30.
    if (!lunch && start + ON_SITE > LUNCH_TO) {
      const begin = Math.max(time, LUNCH_FROM)
      const after = begin + LUNCH + drive
      if (begin <= LUNCH_TO && (stop.from === undefined || after <= stop.from)) {
        rows.push({ kind: 'lunch', start: begin, end: begin + LUNCH })
        if (stop.from === undefined) start = quarter(after)
      }
      // Agreed visits leave no room for it: the day goes on without.
      lunch = true
    }
    if (stop.from !== undefined && time + drive > stop.from) return null
    const end = start + ON_SITE
    if (end > LAST_END) return null
    rows.push({ kind: 'visit', siteId: stop.siteId, start, end, drive, fixed: stop.from !== undefined })
    driving += drive
    km += roadKm(at, stop) ?? 0
    time = end
    at = stop
  }
  const back = stops.length > 0 ? driveMin(at, company) : 0
  return { rows, back, driving: driving + back, km: km + (stops.length > 0 ? (roadKm(at, company) ?? 0) : 0) }
}

/**
 * The stop put in where it adds the least driving and the day still fits (just as short further back: there, so the
 * older customers come first); null when it fits nowhere.
 */
function insert(route: TourStop[], stop: TourStop, company: Point) {
  let best: { route: TourStop[]; tour: Tour } | null = null
  for (let i = 0; i <= route.length; i++) {
    const tried = [...route.slice(0, i), stop, ...route.slice(i)]
    const tour = schedule(tried, company)
    if (tour && (!best || tour.driving < best.tour.driving || (tour.driving === best.tour.driving && tour.km <= best.tour.km + 0.01)))
      best = { route: tried, tour }
  }
  return best
}

/**
 * The tour suggested for a day: the visits agreed on it stay, the oldest enquiry comes along, then the next
 * oldest that lie on the way, as long as the day has room.
 * @param candidates the enquiries of the region, oldest first, with their place on the map
 */
export function suggestTour(candidates: TourStop[], agreed: TourStop[], company: Point): Tour {
  let route = [...agreed].sort((a, b) => a.from! - b.from!)
  let tour = schedule(route, company) ?? { rows: [], back: 0, driving: 0, km: 0 }
  let added = 0
  for (const candidate of candidates) {
    const found = insert(route, candidate, company)
    if (!found) continue
    // The oldest comes along wherever it lies; the others only on the way.
    if (added > 0 && found.tour.driving - tour.driving > MAX_DETOUR) continue
    route = found.route
    tour = found.tour
    added++
  }
  return tour
}

/** The earliest time a customer fits into a day with these visits agreed, or null when the day is full. */
export function nextFree(stop: TourStop, agreed: TourStop[], company: Point): number | null {
  const route = [...agreed].sort((a, b) => a.from! - b.from!)
  let earliest: number | null = null
  for (let i = 0; i <= route.length; i++) {
    const tour = schedule([...route.slice(0, i), { ...stop, from: undefined }, ...route.slice(i)], company)
    const row = tour?.rows.find((r) => r.kind === 'visit' && !r.fixed)
    if (row && (earliest === null || row.start < earliest)) earliest = row.start
  }
  return earliest
}
