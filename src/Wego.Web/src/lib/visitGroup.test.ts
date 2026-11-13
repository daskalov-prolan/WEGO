import { describe, expect, it } from 'vitest'
import type { Entry } from '../api/types'
import { customers, visitGroup, visitsAsOne, visitTime } from './visitGroup'

const entry = (id: number, activity: string, siteId: number | null, startTime: string, endTime: string, siteName: string | null = null): Entry => ({
  id, employeeId: 6, employeeName: 'Stefan', date: '2026-11-18', type: 'Baustelle', siteId, siteName, activity,
  startTime, endTime, note: null, noteImportant: false,
})

describe('visitGroup', () => {
  const morning = [
    entry(1, 'Besichtigung', null, '08:00:00', '12:00:00'),
    entry(3, 'Besichtigung', 31, '10:00:00', '11:00:00', 'Fr. Krause'),
    entry(2, 'Besichtigung', 30, '08:15:00', '09:15:00', 'Fam. Weber'),
    entry(4, 'Sanitaer', 12, '12:30:00', '16:00:00', 'Badstr. 12'),
  ]

  it('takes the visits of a day together: the customers by time, the span and the half of the day', () => {
    const group = visitGroup(morning)!
    expect(group.visits.map((visit) => visit.siteName)).toEqual(['Fam. Weber', 'Fr. Krause'])
    expect(visitTime(group)).toBe('Vormittag · 08:15 – 11:00')
    expect(customers(group.visits.length)).toBe('2 Kunden')
  })

  it('shows a day set aside without customers yet, and nothing without visits', () => {
    const group = visitGroup([entry(1, 'Besichtigung', null, '08:00:00', '16:00:00')])!
    expect(customers(group.visits.length)).toBe('noch keine Kunden')
    expect(visitTime(group)).toBe('08:00 – 16:00')
    expect(visitGroup([morning[3]])).toBeNull()
  })

  it('counts the visits as one entry, the time set aside, for the halves of the day', () => {
    expect(visitsAsOne(morning).map((e) => [e.id, e.startTime, e.endTime])).toEqual([
      [1, '08:00:00', '12:00:00'],
      [4, '12:30:00', '16:00:00'],
    ])
  })
})
