import { describe, expect, it } from 'vitest'
import { allowedActivities, worksInPhase } from './activities'

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
