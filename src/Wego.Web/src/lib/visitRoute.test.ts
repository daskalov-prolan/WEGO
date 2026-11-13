import { describe, expect, it } from 'vitest'
import { bestOrder, driveMin, fitInto, mapsLink, timeline } from './visitRoute'

const company = { latitude: 52.6157, longitude: 13.479 }
// Buch (near), Bernau (north-east, further), Pankow (south-west).
const buch = { name: 'Buch', latitude: 52.633, longitude: 13.496 }
const bernau = { name: 'Bernau', latitude: 52.679, longitude: 13.587 }
const pankow = { name: 'Pankow', latitude: 52.565, longitude: 13.405 }

describe('visitRoute', () => {
  it('estimates the drive in steps of five minutes, at least ten, and twenty without a place', () => {
    expect(driveMin(company, buch)).toBe(10)
    expect(driveMin(company, bernau) % 5).toBe(0)
    expect(driveMin(company, bernau)).toBeGreaterThan(driveMin(company, buch))
    expect(driveMin(company, { latitude: null, longitude: null })).toBe(20)
  })

  it('orders the stops for the least driving, from the company and back', () => {
    // Pankow lies the other way: not between Buch and Bernau.
    const order = bestOrder([bernau, pankow, buch], company).map((stop) => stop.name)
    expect(order.indexOf('Buch')).toBe(1)
  })

  it('gives each customer an hour on site after the drive, on the quarter hour', () => {
    const { stops, end } = timeline([buch, bernau], company, '08:00', company)
    expect(stops[0].from).toBe('08:15')
    expect(stops[0].to).toBe('09:15')
    expect(stops[1].from > stops[0].to).toBe(true)
    expect(end > stops[1].to).toBe(true)
  })

  it('fits a new customer into the gap with the least driving, the agreed times staying', () => {
    const day = { from: '08:00', to: '16:00', start: company, visits: [{ ...bernau, from: '10:00', to: '11:00' }] }
    const fit = fitInto(day, company, buch)!
    // Buch before Bernau, without moving the 10 o'clock.
    expect(fit.time).toBe('08:15')
    // A full morning has no room.
    const full = { from: '08:00', to: '10:00', start: company, visits: [{ ...bernau, from: '08:30', to: '09:30' }] }
    expect(fitInto(full, company, pankow)).toBeNull()
  })

  it('links the tour in Google Maps', () => {
    expect(mapsLink(['Alt-Karow 53, 13125 Berlin', null, 'Hauptstr. 1'])).toBe(
      'https://www.google.com/maps/dir/Alt-Karow%2053%2C%2013125%20Berlin/Hauptstr.%201',
    )
  })
})
