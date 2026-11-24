import { describe, expect, it } from 'vitest'
import { materialAmount, priceCalculation } from './offerCalc'

describe('priceCalculation', () => {
  it('prices each position with its rate, adds up labour and the material named in euros, and names positions without a rate', () => {
    const calc = {
      demSanitaer: { hours: '3' },
      demWandfliesen: { hours: '2,5' },
      frischwasser: { hours: '6', material: '180 €' },
      abfluss: { material: 'Rohre ca. 95,50' },
      lueftung: { hours: '2' },
    }
    const rates = [
      { key: 'demSanitaer', hourlyRate: 50 },
      { key: 'demWandfliesen', hourlyRate: 52 },
      { key: 'frischwasser', hourlyRate: 60 },
    ]
    const priced = priceCalculation(calc, rates)
    expect(priced.groups.map((g) => g.title)).toEqual(['Demontage', 'Sanitärinstallation', 'Lüftung'])
    expect(priced.groups[0].labour).toBe(3 * 50 + 2.5 * 52)
    expect(priced.labour).toBe(150 + 130 + 360)
    expect(priced.material).toBe(180 + 95.5)
    expect(priced.net).toBe(640 + 275.5)
    expect(priced.hours).toBe(13.5)
    // Lüftung has hours but no rate: not in the sum, and said.
    expect(priced.missing).toEqual(['Lüftung'])
  })

  it('reads an amount out of what was written as material', () => {
    expect(materialAmount('180 €')).toBe(180)
    expect(materialAmount('ca. 95,50 EUR')).toBe(95.5)
    expect(materialAmount('Fliesen bringt der Kunde')).toBeNull()
  })
})
