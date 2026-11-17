import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisitEnquiry, VisitPlan } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { VisitPlanner } from './VisitPlanner'

const enquiry = (siteId: number, name: string, region: string | null, north: number, requestedOn: string): VisitEnquiry => ({
  siteId, name, address: `Straße ${siteId}, 13125 Berlin`, phone: '030 1', scope: ['Gäste-WC'], description: null, requestedOn,
  planner: region === 'Karow' ? 'Marina' : 'Jeannette', region, latitude: 52.6157 + north * 0.018, longitude: 13.479, call: null,
})

const plan: VisitPlan = {
  employeeId: 4,
  branches: [{ name: 'WEGO Karow', address: 'Alt-Karow 53, 13125 Berlin', latitude: 52.6115, longitude: 13.4824 }],
  visitors: [],
  regions: ['Karow', 'Reinickendorf'],
  days: [
    {
      date: '2026-11-20', employeeId: 4, employee: 'Stefan Buder', reserved: true,
      visits: [{ entryId: 9, siteId: 7, name: 'Herr Fest', address: 'Weg 1', phone: null, latitude: 52.62, longitude: 13.48, from: '09:00:00', to: '10:00:00', region: 'Karow' }],
    },
    {
      date: '2026-11-25', employeeId: 5, employee: 'Tsonyo Matev', reserved: false,
      visits: [{ entryId: 10, siteId: 8, name: 'Frau Ost', address: 'Weg 2', phone: null, latitude: null, longitude: null, from: '16:00:00', to: '17:00:00', region: 'Reinickendorf' }],
    },
    { date: '2026-11-27', employeeId: 4, employee: 'Stefan Buder', reserved: true, visits: [] },
  ],
  enquiries: [
    { ...enquiry(1, 'Frau Alt', 'Karow', 1, '2026-10-01'), call: { siteId: 1, at: '2026-11-10T09:15:00Z', by: 'Stefan', count: 2 } },
    enquiry(2, 'Herr Neu', 'Karow', 2, '2026-11-01'),
    enquiry(3, 'Familie West', 'Reinickendorf', 3, '2026-10-15'),
  ],
  busy: [{ date: '2026-11-12', name: 'Baustelle Müller', from: '15:30:00', to: '16:30:00' }],
  pending: 0,
  declineReasons: ['Zu lange gewartet', 'Anderer Anbieter beauftragt', 'Vorhaben verschoben', 'Kein Interesse mehr', 'Mehrfach nicht erreicht', 'Sonstiges'],
}

const posted: { url: string; body: unknown }[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-11T09:00:00') })
  posted.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posted.push({ url, body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify(plan), { status: 200 })
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('VisitPlanner', () => {
  it('asks what to plan, then one customer at 16:00 by default with a warning of an overlap', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const changed = vi.fn()
    renderWithProviders(<VisitPlanner onClose={() => {}} onChanged={changed} />)
    expect(await screen.findByText('Was möchten Sie planen?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Besichtigungen Karow\s*2/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Alle Besichtigungen\s*3/ }))

    // The longest waiting on top, with the calls not reached.
    const cards = document.querySelectorAll('.visit-customer')
    expect(cards[0].textContent).toContain('Frau Alt')
    expect(cards[0].textContent).toContain('Nicht erreicht: 10.11.')
    expect(cards[0].textContent).toContain('· Stefan (2×)')

    await user.click(within(cards[0] as HTMLElement).getByRole('button', { name: 'Nicht erreicht' }))
    await waitFor(() => expect(posted).toContainEqual({ url: '/api/visits/not-reached', body: { employeeId: 4, siteId: 1 } }))
    // It stays open on the list, for the next call; the page behind loads again only when it closes.
    expect(screen.getByText('Herr Neu')).toBeInTheDocument()
    expect(changed).not.toHaveBeenCalled()

    // The customer says no: who visits reports it with the reason of the visit, for the planner to confirm.
    await user.click(within(cards[1] as HTMLElement).getByRole('button', { name: 'Kunde sagt ab' }))
    await user.click(screen.getByRole('radio', { name: 'Mehrfach nicht erreicht' }))
    await user.click(screen.getByRole('button', { name: 'Absage melden' }))
    await waitFor(() =>
      expect(posted).toContainEqual({ url: '/api/visits/decline', body: { employeeId: 4, siteId: 2, reason: 'Mehrfach nicht erreicht', note: null } }),
    )

    await user.click(within(cards[0] as HTMLElement).getByRole('button', { name: 'Termin eintragen' }))
    expect(screen.getByLabelText('Uhrzeit')).toHaveValue('16:00')
    expect(screen.getByText(/Achtung: am .* ist schon Baustelle Müller \(15:30–16:30\)/)).toBeInTheDocument()
    // What else is planned that day, below.
    expect(screen.getByText('An diesem Tag schon geplant:')).toBeInTheDocument()
    expect(screen.getByText('15:30–16:30 · Baustelle Müller')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(posted).toContainEqual({ url: '/api/visits', body: { employeeId: 4, siteId: 1, date: '2026-11-12', start: '16:00' } }),
    )
  })

  it('shows the days of visits of everybody; a day opens with its customers, an empty one can be released', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<VisitPlanner onClose={() => {}} />)
    expect(await screen.findByText('Geplante Besichtigungstage')).toBeInTheDocument()
    expect(screen.getByText('KW 47')).toBeInTheDocument()
    expect(screen.getByText('KW 48')).toBeInTheDocument()
    expect(screen.getByText('Tsonyo Matev')).toBeInTheDocument()
    expect(screen.getByText('reserviert, frei')).toBeInTheDocument()

    expect(screen.queryByText('Herr Fest')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Fr 20\.11\.\s*Stefan Buder\s*1 Kunde/ }))
    expect(screen.getByText('Herr Fest')).toBeInTheDocument()
    expect(screen.getByText('09:00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'freigeben' }))
    await waitFor(() => expect(posted).toContainEqual({ url: '/api/visits/days/remove', body: { employeeId: 4, date: '2026-11-27' } }))
  })

  it('opened from a visit in the calendar, shows that day open', async () => {
    renderWithProviders(<VisitPlanner employeeId={4} date="2026-11-20" onClose={() => {}} />)
    expect(await screen.findByText('Herr Fest')).toBeInTheDocument()
  })

  it('lists the customers of a region only, and shows them on the map', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<VisitPlanner onClose={() => {}} />)
    await user.click(await screen.findByRole('button', { name: /Besichtigungen Karow/ }))
    expect(screen.getByText('Frau Alt')).toBeInTheDocument()
    expect(screen.queryByText('Familie West')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Auf Karte anzeigen' }))
    expect(screen.getByRole('region', { name: 'Karte der Besichtigungen' })).toBeInTheDocument()
    expect(screen.getByText('offen (2)')).toBeInTheDocument()
    expect(screen.getByText('vereinbart (1)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /zurück zur Liste/ }))
    expect(screen.getByText('Frau Alt')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /zurück/ }))
    expect(screen.getByText('Was möchten Sie planen?')).toBeInTheDocument()
  })

  it('closes step by step: from the map to the list, to the first page, then the window', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const closed = vi.fn()
    renderWithProviders(<VisitPlanner onClose={closed} />)
    await user.click(await screen.findByRole('button', { name: /Besichtigungen Karow/ }))
    await user.click(screen.getByRole('button', { name: 'Auf Karte anzeigen' }))
    await user.keyboard('{Escape}')
    expect(screen.getByText('Frau Alt')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByText('Was möchten Sie planen?')).toBeInTheDocument()
    expect(closed).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(closed).toHaveBeenCalled()
  })
  it('opens an appointment of a day to change it, not in the way of itself', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<VisitPlanner onClose={() => {}} />)
    await user.click(await screen.findByRole('button', { name: /Fr 20\.11\.\s*Stefan Buder\s*1 Kunde/ }))
    await user.click(screen.getByRole('button', { name: /09:00\s*Herr Fest/ }))
    expect(screen.getByLabelText('Uhrzeit')).toHaveValue('09:00')
    expect(screen.queryByText(/Achtung/)).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Uhrzeit'))
    await user.type(screen.getByLabelText('Uhrzeit'), '11:00')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(posted).toContainEqual({ url: '/api/visits', body: { employeeId: 4, siteId: 7, date: '2026-11-20', start: '11:00' } }),
    )
  })
})
