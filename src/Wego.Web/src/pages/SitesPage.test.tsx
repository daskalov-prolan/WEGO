import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Site } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { SitesPage } from './SitesPage'

function site(id: number, name: string, plannedStart: string | null, plannedEnd: string | null): Site {
  return {
    id, name, client: name, street: null, houseNumber: null, addressAddition: null, postalCode: null, city: null,
    nameSource: 'Auftraggeber', description: null, plannedStart, plannedEnd,
  }
}

const sites = [
  site(1, 'Bäßler', '2026-02-01', '2026-02-20'),
  site(2, 'Arndt', '2026-04-01', '2026-04-30'),
  site(3, 'Zesch', null, null),
  site(4, 'Chung', '2026-03-10', '2026-03-31'),
]

let scrolledTo: string[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-15T09:00:00') })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(sites), { status: 200 })))
  scrolledTo = []
  window.HTMLElement.prototype.scrollIntoView = function () {
    scrolledTo.push(this.id)
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const names = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)

describe('SitesPage', () => {
  it('sorts by planned start and opens where the upcoming sites begin', async () => {
    renderWithProviders(<SitesPage />)
    await screen.findAllByText('Arndt')

    // Without a planned start at the end.
    expect(names()).toEqual(['Bäßler', 'Chung', 'Arndt', 'Zesch'])
    // Chung has started already; Arndt is the first that starts after today.
    expect(scrolledTo.at(-1)).toBe('site-row-2')
    expect(screen.getByText('läuft')).toBeInTheDocument()
  })

  it('sorts by name and back by planned end', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SitesPage />)
    await screen.findAllByText('Arndt')

    await user.click(screen.getByRole('button', { name: /^Name/ }))
    expect(names()).toEqual(['Arndt', 'Bäßler', 'Chung', 'Zesch'])
    await user.click(screen.getByRole('button', { name: /^Name/ }))
    expect(names()).toEqual(['Zesch', 'Chung', 'Bäßler', 'Arndt'])

    scrolledTo = []
    await user.click(screen.getByRole('button', { name: /^Geplantes Ende/ }))
    expect(names()).toEqual(['Bäßler', 'Chung', 'Arndt', 'Zesch'])
    expect(scrolledTo.at(-1)).toBe('site-row-2')
  })
})