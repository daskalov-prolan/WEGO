import { describe, expect, it } from 'vitest'
import type { Entry } from '../api/types'
import { allowedActivities, freeGaps, worksInPhase } from './activities'

describe('allowedActivities', () => {
  it('gives a craftsman who does visits as well the visit of the offer phase, nothing more of it', () => {
    const stefan = { isPlaner: false, isCraftsman: true, mainActivity: 'Sanitaer' as const, additionalActivities: ['Besichtigung' as const] }
    expect(allowedActivities(stefan, 'Angebot')).toEqual(['Besichtigung'])
    expect(worksInPhase(stefan, 'Angebot')).toBe(true)
    expect(allowedActivities(stefan, 'Bauphase')).toContain('Sanitaer')
  })

  it('keeps a craftsman without visits out of the offer phase', () => {
    expect(worksInPhase({ isPlaner: false, isCraftsman: true, additionalActivities: [] }, 'Angebot')).toBe(false)
  })
})

describe('freeGaps', () => {
  const at = (startTime: string | null, endTime: string | null, type: Entry['type'] = 'Baustelle') => ({ type, startTime, endTime })

  it('offers the free time of two hours or more between the work of a day', () => {
    // Sünkler in the morning, a service call in the afternoon: 11:30–14:00 is free.
    expect(freeGaps([at('07:00:00', '11:30:00'), at('14:00:00', '16:00:00')])).toEqual([{ start: '11:30', end: '14:00' }])
    // Half a day: the other half, in its usual times.
    expect(freeGaps([at('07:00:00', '11:30:00')])).toEqual([{ start: '12:00', end: '16:00' }])
    expect(freeGaps([at('12:00:00', '16:00:00')])).toEqual([{ start: '07:30', end: '11:30' }])
  })

  it('counts the Bauberatung and other meetings as taken', () => {
    // Stefan on 25.11.: service calls 7:30–8:00 and 11:00–12:00, the Bauberatung 9:00–10:30 in between.
    const day = [at('07:30:00', '08:00:00'), at('11:00:00', '12:00:00'), at('14:00:00', '15:00:00')]
    expect(freeGaps(day)).toEqual([{ start: '08:00', end: '11:00' }, { start: '12:00', end: '14:00' }])
    // Around the Bauberatung no two hours are left in the morning; midday stays free.
    expect(freeGaps(day, [{ startTime: '09:00:00', endTime: '10:30:00' }])).toEqual([{ start: '12:00', end: '14:00' }])
    // Busy the whole day after his own calendar: nothing free.
    expect(freeGaps([at('07:00:00', '11:30:00')], [{ startTime: null, endTime: null }])).toEqual([])
  })

  it('offers nothing shorter than two hours, on an empty day or one taken without times', () => {
    expect(freeGaps([at('07:00:00', '11:30:00'), at('12:00:00', '16:00:00')])).toEqual([])
    // An hour and a half between two jobs is too little.
    expect(freeGaps([at('07:00:00', '11:30:00'), at('13:00:00', '16:00:00')])).toEqual([])
    expect(freeGaps([])).toEqual([])
    expect(freeGaps([at(null, null)])).toEqual([])
    expect(freeGaps([at(null, null, 'Urlaub')])).toEqual([])
  })
})
