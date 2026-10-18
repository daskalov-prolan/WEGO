import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, Plan, Site } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { SiteMiniPlan } from './SiteMiniPlan'

const site: Site = {
  id: 10, name: 'Familie Schulze', client: 'Familie Schulze', labelProjectNumber: null, street: null, houseNumber: null,
  addressAddition: null, postalCode: null, city: null, nameSource: 'Auftraggeber', description: null,
  // Planned for April, but the first work is planned for early March already.
  plannedStart: '2026-04-01', plannedEnd: null, status: 'Bauphase',
  tasks: [
    { activity: 'Abriss', estimatedDays: 1, notNeeded: false },
    { activity: 'Fliesen', estimatedDays: 1, notNeeded: false },
  ],
}

function entry(id: number, employeeId: number, employeeName: string, date: string, siteId: number, siteName: string, activity: Entry['activity']): Entry {
  return {
    id, employeeId, employeeName, date, type: 'Baustelle', siteId, siteName, activity,
    startTime: null, endTime: null, note: null, noteImportant: false,
  }
}

const plan: Plan = {
  year: 2026,
  employees: [
    { id: 1, name: 'Anna', mainActivity: 'Abriss', additionalActivities: [] },
    { id: 2, name: 'Bernd', mainActivity: 'Fliesen', additionalActivities: [] },
  ],
  sites: [site],
  schoolHolidays: [],
  entries: [
    entry(1, 1, 'Anna', '2026-03-05', 10, 'Familie Schulze', 'Abriss'),
    entry(2, 2, 'Bernd', '2026-03-05', 11, 'Familie Meier', 'Fliesen'),
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-02T09:00:00') })
  fetchMock = vi.fn(async (url: string) =>
    url === '/api/plan/batch' ? new Response('[]', { status: 200 }) : new Response(JSON.stringify(plan), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SiteMiniPlan', () => {
  it('opens at the first planned work that fits the activity filter, else at the planned start', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    // Without a filter: the first entry at this site (Abriss on 5 March), not the planned start in April.
    expect(await screen.findByText('KW 10–11')).toBeInTheDocument()

    const legend = within(screen.getByRole('group', { name: /Ablauf/ }))
    // No Fliesen at this site yet: back to the planned start.
    await user.click(legend.getByRole('button', { name: 'Fliesenarbeiten' }))
    expect(screen.getByText('KW 14–15')).toBeInTheDocument()

    // Abriss as well: its first entry decides.
    await user.click(legend.getByRole('button', { name: 'Abriss / Baubeginn' }))
    expect(screen.getByText('KW 10–11')).toBeInTheDocument()
  })

  it('moves by week and jumps to the next week planned to less than half', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText('KW 10–11')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Woche vor' }))
    expect(screen.getByText('KW 11–12')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Baubeginn' }))
    expect(screen.getByText('KW 14–15')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Heute' }))
    expect(screen.getByText('KW 10–11')).toBeInTheDocument()

    // KW 10 itself is at 20 %, but the jump looks for the next week after the first one shown.
    await user.click(screen.getByRole('button', { name: /Nächste Woche unter 50 %/ }))
    expect(screen.getByText('KW 11–12')).toBeInTheDocument()
  })

  it('shows two calendar weeks from the planned start, the work here and elsewhere, and the open activities', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)

    // The first entry is on Thursday 5 March: the weeks begin on Monday 2 March.
    // Bernd (main activity Fliesen, still open) works one of five days in KW 10, none in KW 11.
    expect(await screen.findByText('KW 10 · 20 %')).toBeInTheDocument()
    expect(screen.getByText('KW 11 · 0 %')).toBeInTheDocument()

    const thursday = screen.getByRole('button', { name: 'Familie Schulze, 2026-03-05' })
    expect(within(thursday).getAllByText('Anna').length).toBeGreaterThan(0)
    expect(within(thursday).getAllByText('Bernd: Familie Meier').length).toBeGreaterThan(0)

    // Abriss is planned already, Fliesen is still open.
    const open = screen.getAllByRole('button').filter((button) => button.classList.contains('task-box'))
    expect(open.map((button) => button.textContent)).toEqual(['Fliesenarbeiten'])

    // Planning it: only who can do it is offered (Bernd lays tiles, Anna does not).
    await user.click(open[0])
    expect(await screen.findByText('Fliesenarbeiten einplanen')).toBeInTheDocument()
    const picker = screen.getAllByLabelText(/^Mitarbeiter/).find((element) => element.tagName === 'INPUT')!
    await user.click(picker)
    const options = (await screen.findAllByRole('option', { hidden: true })).map((option) => option.textContent)
    expect(options).toEqual(['Bernd'])
    await user.click(screen.getByRole('option', { name: 'Bernd', hidden: true }))
    await user.click(screen.getByRole('button', { name: 'Einplanen', hidden: true }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))).toEqual([
      expect.objectContaining({
        employeeId: 2,
        date: '2026-03-02',
        entries: expect.arrayContaining([expect.objectContaining({ siteId: 10, activity: 'Fliesen' })]),
      }),
    ])
  })
})