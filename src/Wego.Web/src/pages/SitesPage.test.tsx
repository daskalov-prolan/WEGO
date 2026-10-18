import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Site } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { SitesPage } from './SitesPage'

function site(id: number, name: string, plannedStart: string | null, plannedEnd: string | null, status: Site['status'] = 'Bauphase'): Site {
  return {
    id, name, client: name, street: null, houseNumber: null, addressAddition: null, postalCode: null, city: null,
    nameSource: 'Auftraggeber', description: null, plannedStart, plannedEnd, status, tasks: [], labelProjectNumber: null,
  }
}

const sites = [
  site(1, 'Bäßler', '2026-02-01', '2026-02-20'),
  site(2, 'Arndt', '2026-04-01', '2026-04-30'),
  site(3, 'Zesch', null, null),
  {
    ...site(4, 'Chung', '2026-03-10', '2026-03-31'),
    tasks: [
      { activity: 'Abriss' as const, estimatedDays: 1, notNeeded: false },
      { activity: 'Trockenbau' as const, estimatedDays: 1, notNeeded: false },
      { activity: 'Sanitaer' as const, estimatedDays: 1, notNeeded: true },
    ],
  },
  site(5, 'Abgesagt', '2026-03-20', '2026-03-25', 'Storniert'),
]

let scrolledTo: string[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-15T09:00:00') })
  // Abriss at Chung is planned (in the plan of 2026), the other years are empty.
  const plan = (year: number) => ({
    year, employees: [], sites, schoolHolidays: [],
    entries: year === 2026
      ? [{ id: 1, employeeId: 1, employeeName: 'Anna', date: '2026-03-11', type: 'Baustelle', siteId: 4, siteName: 'Chung', activity: 'Abriss', startTime: null, endTime: null, note: null, noteImportant: false }]
      : [],
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.startsWith('/api/plan?')
        ? new Response(JSON.stringify(plan(Number(url.split('=').pop()))), { status: 200 })
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

describe('SitesPage', () => {
  it('sorts by planned start and opens where the upcoming sites begin', async () => {
    renderWithProviders(<SitesPage />)
    await screen.findAllByText('Arndt')

    // Without a planned start at the end.
    expect(names()).toEqual(['Bäßler', 'Chung', 'Arndt', 'Zesch'])
    // Chung has started already; Arndt is the first that starts after today.
    await waitFor(() => expect(scrolledTo.at(-1)).toBe('site-row-2'))
    // Done and cancelled sites only with "Alle".
    expect(screen.queryByText('Abgesagt')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Alle' }))
    expect(screen.getAllByText('Abgesagt').length).toBeGreaterThan(0)
  })

  it('sorts by name and back by planned start', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SitesPage />)
    await screen.findAllByText('Arndt')

    await user.click(screen.getByRole('button', { name: /^Name/ }))
    expect(names()).toEqual(['Arndt', 'Bäßler', 'Chung', 'Zesch'])
    await user.click(screen.getByRole('button', { name: /^Name/ }))
    expect(names()).toEqual(['Zesch', 'Chung', 'Bäßler', 'Arndt'])

    scrolledTo = []
    await user.click(screen.getByRole('button', { name: /^Geplanter Start/ }))
    expect(names()).toEqual(['Bäßler', 'Chung', 'Arndt', 'Zesch'])
    await waitFor(() => expect(scrolledTo.at(-1)).toBe('site-row-2'))
  })

  it('shows name, planned start, status and the activities, those still to plan standing out', async () => {
    renderWithProviders(<SitesPage />)
    await screen.findAllByText('Arndt')
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Name',
      'Geplanter Start ▲',
      'Status',
      'Tätigkeiten',
    ])
    const chung = screen.getAllByRole('row').find((row) => row.textContent?.startsWith('Chung'))!
    const state = (label: string) => within(chung).getByText(label).closest('.flow-step')!.getAttribute('data-state')
    await waitFor(() => expect(state('Abriss / Baubeginn')).toBe('planned'))
    expect(state('Trockenbau')).toBe('open')
    expect(state('Sanitär')).toBe('cancelled')
  })
})
