import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, Plan, User } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { MyPlanPage } from './MyPlanPage'

const user: User = { id: 1, name: 'Anna', userName: 'anna', role: 'Handwerker', showInPlan: true, mustChangePassword: false }

function entry(id: number, employeeId: number, employeeName: string, date: string, siteId: number, siteName: string, start: string | null, end: string | null): Entry {
  return {
    id, employeeId, employeeName, date, type: 'Baustelle', siteId, siteName, activity: null,
    startTime: start, endTime: end, note: null, noteImportant: false,
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
      postalCode: '13125', city: 'Berlin', nameSource: 'Auftraggeber', description: 'Komplettbad', plannedStart: null, plannedEnd: null, status: 'Bauphase', tasks: [], labelProjectNumber: null, clientPhone: null,
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
    entry(7, 3, 'Carla', '2026-03-10', 12, 'Familie Werner', '07:00:00', '16:00:00'),
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
  it('names who comes along to a visit without a site yet', async () => {
    const visit = (id: number, employeeId: number, employeeName: string): Entry => ({
      ...entry(id, employeeId, employeeName, '2026-03-05', 0, '', null, null),
      siteId: null,
      siteName: null,
      activity: 'Besichtigung',
    })
    const withVisit: Plan = { ...plan, entries: [...plan.entries, visit(30, 1, 'Anna'), visit(31, 2, 'Bernd')] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(withVisit), { status: 200 })))
    renderWithProviders(<MyPlanPage year={2026} user={user} />)

    const thursday = (await screen.findByText('Donnerstag, 05.03.2026')).closest('article')!
    expect(within(thursday).getByText('mit Bernd')).toBeInTheDocument()
  })

  it('shows the own notes of a day and the free half of a day as "verfügbar"', async () => {
    const withNotes: Plan = {
      ...plan,
      entries: [...plan.entries, entry(20, 1, 'Anna', '2026-03-04', 10, 'Familie Schulze', '07:30:00', '11:30:00')],
      notes: [
        { id: 1, employeeId: 1, date: '2026-03-04', title: 'Schlüssel holen', text: 'Beim Hausmeister' },
        { id: 2, employeeId: 2, date: '2026-03-04', title: 'Nicht für Anna', text: null },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(withNotes), { status: 200 })))
    renderWithProviders(<MyPlanPage year={2026} user={user} />)

    const wednesday = (await screen.findByText('Mittwoch, 04.03.2026')).closest('article')!
    expect(within(wednesday).getByText('Schlüssel holen')).toBeInTheDocument()
    expect(within(wednesday).getByText('Beim Hausmeister')).toBeInTheDocument()
    expect(within(wednesday).queryByText('Nicht für Anna')).not.toBeInTheDocument()
    // Half a day on the site: the afternoon is free.
    expect(within(wednesday).getByText('verfügbar')).toBeInTheDocument()
  })

  it('shows the own week: where, when and with whom', async () => {
    renderWithProviders(<MyPlanPage year={2026} user={user} />)

    const monday = (await screen.findByText('Montag, 02.03.2026')).closest('article')!
    expect(within(monday).getByText('Heute')).toBeInTheDocument()
    expect(within(monday).getByText('8–10 Uhr')).toBeInTheDocument()
    expect(within(monday).getByText('Familie Schulze')).toBeInTheDocument()
    // Bernd is there the whole day, Anna only from 8 to 10: his time is shown.
    expect(within(monday).getByText('mit Bernd (ganztägig)')).toBeInTheDocument()
    expect(within(monday).getByText(/Musterweg 3, 13125 Berlin/)).toBeInTheDocument()
    expect(within(monday).getByText('allein')).toBeInTheDocument()

    // Somebody else's site is none of this employee's business here (Carla on Monday).
    expect(within(monday).queryByText('Familie Werner')).not.toBeInTheDocument()

    const tuesday = screen.getByText('Dienstag, 03.03.2026').closest('article')!
    expect(within(tuesday).getByText('Urlaub')).toBeInTheDocument()
    // The vacation is counted under Mein Bereich, not here.
    expect(screen.queryByText(/Tagen frei/)).not.toBeInTheDocument()
  })

  it('opens the details of a site from its tile: way there, what to do, own days there', async () => {
    renderWithProviders(<MyPlanPage year={2026} user={user} />)
    await screen.findByText('Montag, 02.03.2026')

    await userEvent.click(screen.getByRole('button', { name: 'Familie Schulze: Details öffnen' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('link', { name: 'Navigation starten' })).toHaveAttribute(
      'href',
      expect.stringContaining('destination=Musterweg%203'),
    )
    expect(within(dialog).getByText('Komplettbad')).toBeInTheDocument()
    expect(within(dialog).getByText('mit Bernd (ganztägig)')).toBeInTheDocument()
    expect(within(dialog).getByText('Meine Tage hier (1)')).toBeInTheDocument()
  })

  it('always opens at today, also when another year was chosen last', async () => {
    const onYearChange = vi.fn()
    const { container } = renderWithProviders(<MyPlanPage year={2027} user={user} onYearChange={onYearChange} />)
    await screen.findByText('Montag, 02.03.2026')
    expect(container.querySelector('.my-plan .kw')).toHaveTextContent('KW 10')
    expect(onYearChange).toHaveBeenCalledWith(2026)
  })

  it('shows today on an empty Sunday as well, so the list begins there and not on the Monday before', async () => {
    vi.setSystemTime(new Date('2026-03-15T09:00:00'))
    renderWithProviders(<MyPlanPage year={2026} user={user} />)
    const sunday = (await screen.findByText('Sonntag, 15.03.2026')).closest('article')!
    expect(within(sunday).getByText('Heute')).toBeInTheDocument()
    expect(within(sunday).getByText('nicht eingeplant')).toBeInTheDocument()
    // Other empty weekend days stay out.
    expect(screen.queryByText('Samstag, 14.03.2026')).not.toBeInTheDocument()
  })

  it('pages on into the next year after the last week, and offers no year before 2026', async () => {
    vi.setSystemTime(new Date('2026-12-28T09:00:00'))
    const onYearChange = vi.fn()
    renderWithProviders(<MyPlanPage year={2026} user={user} onYearChange={onYearChange} />)
    await screen.findByText('Montag, 28.12.2026')
    expect(screen.getByRole('combobox', { name: 'Jahr' }).querySelectorAll('option')[0]).toHaveTextContent('2026')

    await userEvent.click(screen.getByRole('button', { name: 'Nächste Woche' }))
    expect(onYearChange).toHaveBeenCalledWith(2027)
  })

  it('shows a public holiday as such, not as vacation, also when a closure entered vacation on it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ...plan,
            schoolHolidays: [{ id: -1, name: 'Tag der Arbeit', kind: 'Feiertag', startDate: '2026-05-01', endDate: '2026-05-01' }],
            entries: [{ ...entry(30, 1, 'Anna', '2026-05-01', 0, '', null, null), type: 'Urlaub', siteId: null, siteName: null }],
          }),
          { status: 200 },
        ),
      ),
    )
    renderWithProviders(<MyPlanPage year={2026} user={user} />)
    const friday = (await screen.findByText('Freitag, 01.05.2026')).closest('article')!
    expect(within(friday).getByText('Gesetzlicher Feiertag')).toBeInTheDocument()
    expect(within(friday).queryByText('Urlaub')).not.toBeInTheDocument()
    expect(within(friday).getByText('Tag der Arbeit')).toBeInTheDocument()
  })

  it('moves to the next week', async () => {
    renderWithProviders(<MyPlanPage year={2026} user={user} />)
    await screen.findByText('Montag, 02.03.2026')

    await userEvent.click(screen.getByRole('button', { name: 'Nächste Woche' }))

    const tuesday = screen.getByText('Dienstag, 10.03.2026').closest('article')!
    expect(within(tuesday).getByText('Familie Werner')).toBeInTheDocument()
    // Same time as Anna (the whole day): no time in brackets.
    expect(within(tuesday).getByText('mit Carla')).toBeInTheDocument()
  })
})
