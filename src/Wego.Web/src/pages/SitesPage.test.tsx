import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Site } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { SitesPage } from './SitesPage'

function site(id: number, name: string, plannedStart: string | null, plannedEnd: string | null, status: Site['status'] = 'Bauphase'): Site {
  return {
    id, name, client: name, street: null, houseNumber: null, addressAddition: null, postalCode: null, city: null,
    nameSource: 'Auftraggeber', description: null, plannedStart, plannedEnd, status, tasks: [], labelProjectNumber: null, clientPhone: null,
  }
}

const sites = [
  site(1, 'Bäßler', '2026-02-01', '2026-02-20'),
  site(2, 'Arndt', '2026-04-01', '2026-04-30'),
  site(3, 'Zesch', null, null),
  {
    ...site(4, 'Chung', '2026-03-10', '2026-03-31'),
    street: 'Alt-Karow 53', postalCode: '13125', city: 'Berlin', clientPhone: '030 123 45', responsiblePlannerId: 9,
  },
  site(5, 'Abgesagt', '2026-03-20', '2026-03-25', 'Storniert'),
]

let scrolledTo: string[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-15T09:00:00') })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/sites/planners'
        ? new Response(JSON.stringify([{ id: 9, name: 'Planer G', isMe: true }]), { status: 200 })
        : new Response(JSON.stringify(sites), { status: 200 }),
    ),
  )
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

/** Chooses which sites the list shows. */
async function choose(label: string) {
  await userEvent.click(screen.getAllByLabelText('Anzeigen').find((element) => element.tagName === 'INPUT')!)
  await userEvent.click(await screen.findByRole('option', { name: label, hidden: true }))
}

describe('SitesPage', () => {
  it('shows the construction phase first, then the active sites: begun and not done yet', async () => {
    renderWithProviders(<SitesPage />)
    await screen.findAllByText('Chung')

    // Every site in the construction phase, whenever it starts.
    expect(names()).toEqual(['Bäßler', 'Chung', 'Arndt', 'Zesch'])
    // Today is 15 March 2026: Arndt begins later, Zesch has no start, Abgesagt is cancelled.
    await choose('Aktive Baustellen')
    expect(names()).toEqual(['Bäßler', 'Chung'])
    // All but the cancelled ones.
    await choose('Alle Baustellen (ohne stornierte)')
    expect(names()).toEqual(['Bäßler', 'Chung', 'Arndt', 'Zesch'])
  })

  it('sorts by planned start and opens where the upcoming sites begin', async () => {
    renderWithProviders(<SitesPage />)
    await screen.findAllByText('Chung')

    // Without a planned start at the end.
    expect(names()).toEqual(['Bäßler', 'Chung', 'Arndt', 'Zesch'])
    // Chung has started already; Arndt is the first that starts after today.
    await waitFor(() => expect(scrolledTo.at(-1)).toBe('site-row-2'))
  })

  it('sorts by name and back by planned start', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SitesPage />)
    await screen.findAllByText('Chung')

    await user.click(screen.getByRole('button', { name: /^Name/ }))
    expect(names()).toEqual(['Arndt', 'Bäßler', 'Chung', 'Zesch'])
    await user.click(screen.getByRole('button', { name: /^Name/ }))
    expect(names()).toEqual(['Zesch', 'Chung', 'Bäßler', 'Arndt'])

    scrolledTo = []
    await user.click(screen.getByRole('button', { name: /^Geplanter Start/ }))
    expect(names()).toEqual(['Bäßler', 'Chung', 'Arndt', 'Zesch'])
    await waitFor(() => expect(scrolledTo.at(-1)).toBe('site-row-2'))
  })

  it('shows name, planned start, status, the planner in charge, address and phone of the customer', async () => {
    renderWithProviders(<SitesPage />)
    await screen.findAllByText('Chung')
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Name',
      'Geplanter Start ▲',
      'Status',
      'Zuständig',
      'Adresse',
      'Telefon Kunde',
      'Setze auf erledigt',
    ])
    const chung = screen.getAllByRole('row').find((row) => row.textContent?.startsWith('Chung'))!
    expect(await within(chung).findByText('Planer G')).toBeInTheDocument()
    expect(within(chung).getByText('Alt-Karow 53, 13125 Berlin')).toBeInTheDocument()
    expect(within(chung).getByRole('link', { name: '030 123 45' })).toHaveAttribute('href', 'tel:03012345')
  })

  it('shows the sites in a status, starting in a year or in the last six months', async () => {
    renderWithProviders(<SitesPage />)
    await screen.findAllByText('Chung')

    await choose('Status Storniert')
    expect(names()).toEqual(['Abgesagt'])
    // Bäßler and Chung started in the last six months, Abgesagt starts later.
    await choose('Start in den letzten 6 Monaten')
    expect(names()).toEqual(['Bäßler', 'Chung'])
    await choose('Start im Jahr 2026')
    expect(names()).toEqual(['Bäßler', 'Chung', 'Abgesagt', 'Arndt'])
    await choose('Start im Jahr 2027')
    expect(screen.getAllByRole('row')).toHaveLength(1)
  })

  it('sets a site in the construction phase done with its switch', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.mocked(fetch)
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
    fetchMock.mockImplementation((async (url: string, init?: RequestInit) =>
      url === '/api/sites/4/status'
        ? new Response(JSON.stringify({ ...sites[3], status: 'Abgeschlossen' }), { status: 200 })
        : base(url, init)) as never,
    )
    renderWithProviders(<SitesPage />)
    await screen.findAllByText('Chung')
    const chung = screen.getAllByRole('row').find((row) => row.textContent?.startsWith('Chung'))!
    await user.click(within(chung).getByRole('switch', { name: 'Chung erledigt' }))

    // Done, it leaves the construction phase.
    await waitFor(() => expect(names()).toEqual(['Bäßler', 'Arndt', 'Zesch']))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/sites/4/status')!
    expect(JSON.parse(String(call[1]!.body))).toEqual({ status: 'Abgeschlossen' })
  })

  it('groups the sites by the planner in charge or by status', async () => {
    renderWithProviders(<SitesPage />)
    await screen.findAllByText('Chung')
    await choose('Alle Baustellen (ohne stornierte)')
    const groupRows = () => [...document.querySelectorAll('.group-row')].map((row) => row.textContent)

    await userEvent.click(screen.getAllByLabelText('Gruppieren').find((element) => element.tagName === 'INPUT')!)
    await userEvent.click(await screen.findByRole('option', { name: 'nach Zuständigkeit', hidden: true }))
    await waitFor(() => expect(groupRows()).toEqual(['Planer G (1)', 'Ohne Zuständigkeit (3)']))

    await userEvent.click(screen.getAllByLabelText('Gruppieren').find((element) => element.tagName === 'INPUT')!)
    await userEvent.click(await screen.findByRole('option', { name: 'nach Status', hidden: true }))
    expect(groupRows()).toEqual(['Bauphase (4)'])
  })
})
