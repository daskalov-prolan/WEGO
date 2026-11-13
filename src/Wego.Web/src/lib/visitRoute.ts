/**
 * Driving between the customers of a day of visits, estimated from their places on the map: the road is about
 * 1.3 times the straight line, at about 40 km/h in and around Berlin; in steps of 5 minutes, at least 10.
 * Each visit is an hour on site.
 */

export interface Point {
  latitude: number | null
  longitude: number | null
}

export const ON_SITE = 60

/** When a place is not on the map yet: a drive of this many minutes is assumed. */
const UNKNOWN_DRIVE = 20

/** Kilometres as the crow flies. */
export function km(a: Point, b: Point): number | null {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return null
  const r = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * r
  const dLon = (b.longitude - a.longitude) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

/** Kilometres on the road (estimated). */
export const roadKm = (a: Point, b: Point) => {
  const straight = km(a, b)
  return straight === null ? null : straight * 1.3
}

/** Minutes of driving (estimated). */
export function driveMin(a: Point, b: Point): number {
  const road = roadKm(a, b)
  if (road === null) return UNKNOWN_DRIVE
  return Math.max(10, Math.round(((road / 40) * 60) / 5) * 5)
}

export const toMin = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}
export const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** The total driving of stops in this order, from the start and back to the company. */
function cost<T extends Point>(start: Point, end: Point, stops: T[]) {
  let total = 0
  let at = start
  for (const stop of stops) {
    total += driveMin(at, stop)
    at = stop
  }
  return total + driveMin(at, end)
}

/**
 * The order with the least driving: every order is tried for the few stops of a day (up to 7), beyond that the
 * nearest next stop each time.
 */
export function bestOrder<T extends Point>(stops: T[], start: Point, end: Point = start): T[] {
  if (stops.length <= 1) return stops
  if (stops.length > 7) {
    const rest = [...stops]
    const order: T[] = []
    let at: Point = start
    while (rest.length > 0) {
      rest.sort((a, b) => driveMin(at, a) - driveMin(at, b))
      const next = rest.shift()!
      order.push(next)
      at = next
    }
    return order
  }
  let best = stops
  let bestCost = Infinity
  const permute = (rest: T[], done: T[]) => {
    if (rest.length === 0) {
      const total = cost(start, end, done)
      if (total < bestCost) {
        bestCost = total
        best = done
      }
      return
    }
    rest.forEach((stop, index) => permute([...rest.slice(0, index), ...rest.slice(index + 1)], [...done, stop]))
  }
  permute(stops, [])
  return best
}

export interface Stop<T> {
  item: T
  /** Minutes of driving to it, and the kilometres (null when a place is not on the map). */
  drive: number
  km: number | null
  from: string
  to: string
}

/** The stops of a day in this order: each an hour on site, with the drive before it; then the way back. */
export function timeline<T extends Point>(stops: T[], start: Point, begin: string, end: Point) {
  let minute = toMin(begin)
  let at = start
  const list: Stop<T>[] = stops.map((item) => {
    const drive = driveMin(at, item)
    const road = roadKm(at, item)
    // Appointments on the quarter hour.
    minute = Math.ceil((minute + drive) / 15) * 15
    const stop = { item, drive, km: road, from: toTime(minute), to: toTime(minute + ON_SITE) }
    minute += ON_SITE
    at = item
    return stop
  })
  const back = stops.length > 0 ? { drive: driveMin(at, end), km: roadKm(at, end) } : null
  return { stops: list, back, end: toTime(minute + (back?.drive ?? 0)) }
}

export interface Booked extends Point {
  from: string
  to: string
}

/**
 * Where a new customer fits into a day without moving the times agreed with others: the gap (before, between
 * or after the visits) with the least extra driving, at the earliest quarter hour there. Null: the day is full.
 */
export function fitInto(
  day: { from: string; to: string; start: Point; visits: Booked[] },
  company: Point,
  customer: Point,
): { time: string; extra: number } | null {
  const visits = [...day.visits].sort((a, b) => a.from.localeCompare(b.from))
  const points = [
    { at: day.start as Point, to: toMin(day.from) },
    ...visits.map((visit) => ({ at: visit as Point, from: toMin(visit.from), to: toMin(visit.to) })),
  ]
  let best: { time: string; extra: number } | null = null
  for (let i = 0; i < points.length; i++) {
    const before = points[i]
    const after = visits[i]
    const there = driveMin(before.at, customer)
    const begin = Math.ceil((before.to + there) / 15) * 15
    // The next visit, or the end of the day (and the way back to the company after it).
    const onward = after ? driveMin(customer, after) : 0
    const limit = after ? toMin(after.from) : toMin(day.to)
    if (begin + ON_SITE + onward > limit) continue
    const usual = after ? driveMin(before.at, after) : driveMin(before.at, company)
    const extra = there + (after ? onward : driveMin(customer, company)) - usual
    if (!best || extra < best.extra) best = { time: toTime(begin), extra: Math.max(0, extra) }
  }
  return best
}

/** A route over the stops in Google Maps, from the start and back to the company: opens the Maps app, free of charge. */
export function mapsLink(addresses: (string | null)[]): string {
  return 'https://www.google.com/maps/dir/' + addresses.filter(Boolean).map((address) => encodeURIComponent(address!)).join('/')
}
