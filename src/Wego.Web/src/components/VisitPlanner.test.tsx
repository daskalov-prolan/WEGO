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
  company: { name: 'Betrieb', address: 'Alt-Karow 53, 13125 Berlin', latitude: 52.6157, longitude: 13.479 },
  visitors: [],
  regions: ['Karow', 'Reinickendorf'],
  days: [{ date: '2026-11-20', visits: [] }, { date: '2026-11-27', visits: [] }],
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
    expect(screen.getByRole('button', { name: /Besichtigungen Region Karow\s*2/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Einzelne Besichtigung/ }))

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

  it('opened from a day of visits in the calendar, starts at that day with what is agreed and all customers', async () => {
    const withVisit: VisitPlan = {
      ...plan,
      days: [{
        date: '2026-11-20', reserved: true,
        visits: [{ entryId: 9, siteId: 7, name: 'Herr Fest', address: 'Weg 1', phone: null, latitude: 52.62, longitude: 13.48, from: '09:00:00', to: '10:00:00' }],
      }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(withVisit), { status: 200 })))
    renderWithProviders(<VisitPlanner employeeId={4} date="2026-11-20" onClose={() => {}} />)
    expect(await screen.findByText('Schon vereinbart')).toBeInTheDocument()
    expect(screen.getByText(/09:00–10:00 Herr Fest/)).toBeInTheDocument()
    expect(screen.getByText('Kunden ohne Termin, die ältesten oben')).toBeInTheDocument()
    // All customers, of every region; each with the first free time around the agreed visit.
    expect(screen.getByText('Familie West')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Termin eintragen \(frei ab \d\d:\d\d\)/ }).length).toBe(3)
  })

  it('plans a region on a day set aside: the tour suggested from the oldest, agreed customer by customer', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<VisitPlanner onClose={() => {}} />)
    await user.click(await screen.findByRole('button', { name: /Besichtigungen Region Karow/ }))
    expect(screen.getByText('Welchen Besichtigungstag möchten Sie planen?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Fr 20.11.2026/ }))

    // Only the customers of the region.
    expect(screen.queryByText('Familie West')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tour vorschlagen' }))
    expect(screen.getByRole('link', { name: 'Route in Google Maps ›' })).toHaveAttribute('href', expect.stringContaining('Alt-Karow'))
    const times = [...document.querySelectorAll('.visit-time')].map((row) => row.textContent?.slice(0, 5))
    expect(times).toEqual(['07:45', '09:00'])

    await user.click(screen.getAllByRole('button', { name: 'Termin angenommen' })[0])
    await waitFor(() =>
      expect(posted).toContainEqual({ url: '/api/visits', body: { employeeId: 4, siteId: 1, date: '2026-11-20', start: '07:45' } }),
    )
    // The customer cannot that day: the next day of visits with its first free time.
    await user.click(screen.getAllByRole('button', { name: 'Kann an diesem Tag nicht' })[1])
    await user.click(screen.getByRole('button', { name: /Fr 27.11.2026 um 07:45 eintragen/ }))
    await waitFor(() =>
      expect(posted).toContainEqual({ url: '/api/visits', body: { employeeId: 4, siteId: 2, date: '2026-11-27', start: '07:45' } }),
    )
  })
})
