import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, Plan, User } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { MyPlanPage } from './MyPlanPage'

const user: User = { id: 1, name: 'Anna', userName: 'anna', role: 'Mitarbeiter', showInPlan: true, mustChangePassword: false }

function entry(id: number, employeeId: number, employeeName: string, date: string, siteId: number, siteName: string, start: string | null, end: string | null): Entry {
  return {
    id, employeeId, employeeName, date, type: 'Baustelle', siteId, siteName, activity: null,
    startTime: start, endTime: end, note: null,
  }
}

const plan: Plan = {
  year: 2026,
  employees: [
    { id: 1, name: 'Anna', mainActivity: null, additionalActivities: [] },
    { id: 2, name: 'Bernd', mainActivity: null, additionalActivities: [] },
    { id: 3, name: 'Carla', mainActivity: null, additionalActivities: [] },
  ],
  sites: [
    {
      id: 10, name: 'Familie Schulze', client: 'Familie Schulze', street: 'Musterweg', houseNumber: '3', addressAddition: null,
      postalCode: '13125', city: 'Berlin', nameSource: 'Auftraggeber', description: 'Komplettbad', plannedStart: null, plannedEnd: null,
    },
  ],
  schoolHolidays: [],
  entries: [
    entry(1, 1, 'Anna', '2026-03-02', 10, 'Familie Schulze', '08:00:00', '10:00:00'),
    entry(2, 1, 'Anna', '2026-03-02', 11, 'Familie Meier', '11:00:00', '13:00:00'),
    entry(3, 2, 'Bernd', '2026-03-02', 10, 'Familie Schulze', null, null),
    entry(4, 3, 'Carla', '2026-03-02', 12, 'Familie Werner', null, null),
    { ...entry(5, 1, 'Anna', '2026-03-03', 0, '', null, null), type: 'Urlaub', siteId: null, siteName: null },
    entry(6, 1, 'Anna', '2026-03-10', 12, 'Familie Werner', null, null),
  ],
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-02T09:00:00') })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.startsWith('/api/plan')
        ? new Response(JSON.stringify(plan), { status: 200 })
        : new Response(
            JSON.stringify({ vacation: { employeeId: 1, employeeName: 'Anna', entitlement: 30, used: 1, remaining: 29, sickDays: 0 } }),
            { status: 200 },
          ),
    ),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('MyPlanPage', () => {
  it('shows the own week: where, when and with whom', async () => {
    renderWithProviders(<MyPlanPage year={2026} user={user} />)

    const monday = (await screen.findByText('Montag, 02.03.2026')).closest('section')!
    expect(within(monday).getByText('Heute')).toBeInTheDocument()
    expect(within(monday).getByText('8–10 Uhr')).toBeInTheDocument()
    expect(within(monday).getByText('Familie Schulze')).toBeInTheDocument()
    expect(within(monday).getByText('mit Bernd')).toBeInTheDocument()
    expect(within(monday).getByText(/Musterweg 3, 13125 Berlin/)).toBeInTheDocument()
    expect(within(monday).getByRole('link', { name: 'Karte' })).toHaveAttribute('href', expect.stringContaining('Musterweg%203'))
    expect(within(monday).getByText('Komplettbad')).toBeInTheDocument()
    expect(within(monday).getByText('allein')).toBeInTheDocument()

    // Somebody else's site is none of this employee's business here.
    expect(screen.queryByText('Familie Werner')).not.toBeInTheDocument()

    const tuesday = screen.getByText('Dienstag, 03.03.2026').closest('section')!
    expect(within(tuesday).getByText('Urlaub')).toBeInTheDocument()
    expect(await screen.findByText('Urlaub: 29 von 30 Tagen frei')).toBeInTheDocument()
  })

  it('moves to the next week', async () => {
    renderWithProviders(<MyPlanPage year={2026} user={user} />)
    await screen.findByText('Montag, 02.03.2026')

    await userEvent.click(screen.getByRole('button', { name: 'Nächste Woche' }))

    const tuesday = screen.getByText('Dienstag, 10.03.2026').closest('section')!
    expect(within(tuesday).getByText('Familie Werner')).toBeInTheDocument()
    expect(within(tuesday).getByText('allein')).toBeInTheDocument()
  })
})
