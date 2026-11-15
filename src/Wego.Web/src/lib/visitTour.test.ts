import { describe, expect, it } from 'vitest'
import { toTime } from './visitRoute'
import { nextFree, schedule, suggestTour, type Tour, type TourStop } from './visitTour'

const company = { latitude: 52.6157, longitude: 13.479 }
// Places north of Berlin about 2 km apart (a drive of 10 minutes each), and one far away.
const near = (siteId: number, north: number): TourStop => ({ siteId, latitude: 52.6157 + north * 0.018, longitude: 13.479 })
const far: TourStop = { siteId: 99, latitude: 52.3, longitude: 13.0 }
const farEast: TourStop = { siteId: 98, latitude: 52.6, longitude: 14.1 }

const times = (tour: Tour) =>
  tour.rows.map((row) => (row.kind === 'lunch' ? `Pause ${toTime(row.start)}` : `${row.siteId} ${toTime(row.start)}`))

describe('visit tours', () => {
  it('leaves at 7:30, an hour at each customer on the quarter hour, the lunch break before 12:30, done by 16:00', () => {
    const stops = [1, 2, 3, 4, 5, 6, 7].map((id) => near(id, id))
    const tour = schedule(stops.slice(0, 6), company)!
    expect(times(tour)).toEqual(['1 07:45', '2 09:00', '3 10:15', '4 11:30', 'Pause 12:30', '5 13:15', '6 14:30'])
    // Seven do not fit: the last would end after 16:00.
    expect(schedule(stops, company)).toBeNull()
  })

  it('suggests the oldest first and then the next oldest on the way, around the visits agreed', () => {
    const agreed = [{ ...near(5, 1), from: 9 * 60 }]
    // The oldest is far away, still it comes along; the next far one does not.
    const tour = suggestTour([far, near(1, 2), farEast, near(2, 3)], agreed, company)
    const ids = tour.rows.flatMap((row) => (row.kind === 'visit' ? [row.siteId] : []))
    expect(ids).toContain(99)
    expect(ids).not.toContain(98)
    expect(ids).toEqual(expect.arrayContaining([5, 1, 2]))
    expect(tour.rows.find((row) => row.kind === 'visit' && row.siteId === 5)).toMatchObject({ start: 9 * 60, fixed: true })
  })

  it('finds the next free time on a day', () => {
    expect(toTime(nextFree(near(1, 1), [], company)!)).toBe('07:45')
    const full = [8, 9, 10, 11, 13, 14, 15].map((hour, i) => ({ ...near(10 + i, 0), from: hour * 60 }))
    expect(nextFree(near(1, 1), full, company)).toBeNull()
  })
})
