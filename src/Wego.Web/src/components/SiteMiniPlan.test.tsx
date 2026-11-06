import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, Plan, Site } from '../api/types'
import { byText, renderWithProviders } from '../test-utils'
import { SiteMiniPlan } from './SiteMiniPlan'

const site: Site = {
  id: 10, name: 'Familie Schulze', client: 'Familie Schulze', labelProjectNumber: null, clientPhone: null, street: null, houseNumber: null,
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
  it('opens at the first planned work, without any at the planned start', async () => {
    // The first entry at this site (Abriss on 5 March), not the planned start in April.
    const { unmount } = renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText(byText('KW 10 · ab 02.03.'))).toBeInTheDocument()
    unmount()

    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...plan, entries: [] }), { status: 200 }))
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText(byText('KW 14 · ab 30.03.'))).toBeInTheDocument()
  })

  it('moves by week and jumps to the next week in which someone who can do open work is free', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText(byText('KW 10 · ab 02.03.'))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Woche vor' }))
    expect(screen.getByText(byText('KW 11 · ab 09.03.'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Baubeginn' }))
    expect(screen.getByText(byText('KW 14 · ab 30.03.'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Heute' }))
    expect(screen.getByText(byText('KW 10 · ab 02.03.'))).toBeInTheDocument()

    // Bernd is free in KW 10 too, but the jump looks for the next week after the first one shown.
    await user.click(screen.getByRole('button', { name: /Nächste freie Woche/ }))
    expect(screen.getByText(byText('KW 11 · ab 09.03.'))).toBeInTheDocument()
  })

  it('counts every craftsman for the free week, and any entry makes the week taken', async () => {
    const user = userEvent.setup()
    const busier: Plan = {
      ...plan,
      employees: [
        ...plan.employees,
        // Carla is a craftsman as well; Dora only plans (no row in the plan), she does no tiles.
        { id: 3, name: 'Carla', mainActivity: null, additionalActivities: [] },
        { id: 4, name: 'Dora', mainActivity: null, additionalActivities: [], isPlaner: true, isCraftsman: false },
      ],
      entries: [
        ...plan.entries,
        entry(6, 1, 'Anna', '2026-03-11', 11, 'Familie Meier', 'Abriss'),
        entry(7, 1, 'Anna', '2026-03-17', 11, 'Familie Meier', 'Abriss'),
        entry(3, 2, 'Bernd', '2026-03-09', 11, 'Familie Meier', 'Fliesen'),
        entry(4, 2, 'Bernd', '2026-03-16', 11, 'Familie Meier', 'Fliesen'),
        entry(5, 3, 'Carla', '2026-03-10', 11, 'Familie Meier', 'Sanitaer'),
      ],
    }
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/plan/batch' ? new Response('[]', { status: 200 }) : new Response(JSON.stringify(busier), { status: 200 }),
    )
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText(byText('KW 10 · ab 02.03.'))).toBeInTheDocument()

    // KW 11: Anna, Bernd and Carla have an entry, Dora is free but does no work on sites. KW 12: Carla is free.
    await user.click(screen.getByRole('button', { name: /Nächste freie Woche/ }))
    expect(screen.getByText(byText('KW 12 · ab 16.03.'))).toBeInTheDocument()
    // Lanes only for who worked here: Anna. Carla counts for the free week, but has no lane.
    expect([...document.querySelectorAll('.mini-lane-name')].map((lane) => lane.textContent)).toEqual(['Anna'])
  })

  it('shows a lane per employee who worked here and only the calendar week above the days', async () => {
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)

    // The first entry is on Thursday 5 March: the weeks begin on Monday 2 March.
    expect((await screen.findAllByText(byText('KW 10'))).length).toBeGreaterThan(0)
    expect(screen.getAllByText(byText('KW 11')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()

    // A lane only for who worked here: Anna, not Bernd.
    expect(screen.getByRole('button', { name: 'Anna, 2026-03-05' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bernd, 2026-03-05' })).not.toBeInTheDocument()
  })

  it('moves its entries by dragging them onto a day of a lane', async () => {
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText(byText('KW 10 · ab 02.03.'))).toBeInTheDocument()
    const batch = () => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')
      return call ? JSON.parse(String(call[1].body)) : null
    }
    const dropOn = (source: Element, target: Element) => {
      fireEvent.dragStart(source)
      const taken = !fireEvent.dragOver(target)
      fireEvent.drop(target)
      fireEvent.dragEnd(source)
      return taken
    }

    // Anna's day here moves to Friday; her own cell does not take it.
    const chip = within(screen.getByRole('button', { name: 'Anna, 2026-03-05' })).getAllByText('Abriss / Baubeginn')[0].closest('.chip')!
    expect(dropOn(chip, screen.getByRole('button', { name: 'Anna, 2026-03-05' }))).toBe(false)
    expect(dropOn(chip, screen.getByRole('button', { name: 'Anna, 2026-03-06' }))).toBe(true)
    await waitFor(() => expect(batch()).not.toBeNull())
    expect(batch()).toEqual([
      { employeeId: 1, date: '2026-03-05', entries: [] },
      expect.objectContaining({ employeeId: 1, date: '2026-03-06', entries: [expect.objectContaining({ siteId: 10 })] }),
    ])
  })

})
