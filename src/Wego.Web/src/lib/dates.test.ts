import { describe, expect, it } from 'vitest'
import { daysBetween, daysOfYear, formatDate, formatTimeRange } from './dates'

describe('dates', () => {
  it('lists every day of a year once, also across daylight saving changes', () => {
    const days = daysOfYear(2026)
    expect(days).toHaveLength(365)
    expect(new Set(days.map((day) => day.iso)).size).toBe(365)
    expect(days[0].iso).toBe('2026-01-01')
    expect(days[364].iso).toBe('2026-12-31')
    expect(daysOfYear(2028)).toHaveLength(366)
  })

  it('marks weekends', () => {
    const days = daysBetween('2026-08-07', '2026-08-10')
    expect(days.map((day) => `${day.weekday}:${day.isWeekend}`)).toEqual([
      'Fr:false',
      'Sa:true',
      'So:true',
      'Mo:false',
    ])
  })

  it('formats dates and time windows the German way', () => {
    expect(formatDate('2026-03-02')).toBe('Mo 02.03.2026')
    expect(formatTimeRange({ startTime: '08:00:00', endTime: '10:30:00' })).toBe('8–10:30 Uhr')
    expect(formatTimeRange({ startTime: null, endTime: null })).toBe('')
  })
})
