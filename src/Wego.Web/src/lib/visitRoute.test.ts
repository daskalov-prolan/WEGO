import { describe, expect, it } from 'vitest'
import { mapsLink } from './visitRoute'

describe('visitRoute', () => {
  it('links the tour in Google Maps', () => {
    expect(mapsLink(['Alt-Karow 53, 13125 Berlin', null, 'Hauptstr. 1'])).toBe(
      'https://www.google.com/maps/dir/Alt-Karow%2053%2C%2013125%20Berlin/Hauptstr.%201',
    )
  })
})
