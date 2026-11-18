import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisitEnquiry } from '../api/types'
import { remindsToday, waitingEnquiries } from '../lib/visitReminders'
import { renderWithProviders } from '../test-utils'
import { VisitReminders } from './VisitReminders'

const enquiry = (siteId: number, name: string, requestedOn: string, extra: Partial<VisitEnquiry> = {}): VisitEnquiry => ({
  siteId, name, address: null, phone: null, scope: [], description: null, requestedOn, planner: null, region: null,
  latitude: null, longitude: null, call: null, ...extra,
})

// Today the 20th: Albers waits 9 days, Brandt 8, Christ 3; Dorn 12, but a no is reported.
const enquiries = [
  enquiry(1, 'Albers', '2026-11-11'),
  enquiry(2, 'Brandt', '2026-11-12'),
  enquiry(3, 'Christ', '2026-11-17'),
  enquiry(4, 'Dorn', '2026-11-08', { report: { siteId: 4, reason: 'Kein Interesse mehr', note: null, by: 'Stefan', at: '2026-11-19T09:00:00Z' } }),
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T08:00:00') })
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

const serve = (list: VisitEnquiry[]) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enquiries: list }), { status: 200 })))

describe('visit reminders', () => {
  it('counts a customer waiting from the 7th day and reminds on the 7th, 9th, 11th day', () => {
    expect(waitingEnquiries(enquiries, '2026-11-20').map(({ enquiry, days }) => [enquiry.name, days])).toEqual([['Albers', 9], ['Brandt', 8]])
    expect([6, 7, 8, 9, 10, 11].map(remindsToday)).toEqual([false, true, false, true, false, true])
  })

  it('shows the waiting customers in the head of Mein Plan and, on a day of reminding, opens them once a day', async () => {
    serve(enquiries)
    const onPlan = vi.fn()
    const { unmount } = renderWithProviders(<VisitReminders employeeId={4} version={0} onPlan={onPlan} />)
    const dialog = await screen.findByRole('dialog', { name: 'Kunden warten auf Ihren Anruf' })
    expect(within(dialog).getByText('Kunde wartet auf Terminvereinbarung seit 9 Tagen')).toBeInTheDocument()
    expect(within(dialog).getByText('Brandt')).toBeInTheDocument()
    expect(within(dialog).queryByText('Christ')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Dorn')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByText('Albers'))
    expect(onPlan).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '2 Kunden warten auf Terminvereinbarung' })).toBeInTheDocument()

    // The same day again: the bar, but it does not open by itself.
    unmount()
    renderWithProviders(<VisitReminders employeeId={4} version={0} onPlan={onPlan} />)
    expect(await screen.findByRole('button', { name: '2 Kunden warten auf Terminvereinbarung' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('names the enquiries come in since he last looked, until he has seen them', async () => {
    localStorage.setItem('wego.visits.reminded.4', '2026-11-20')
    localStorage.setItem('wego.visits.seen.4', JSON.stringify([1, 2, 4]))
    serve([...enquiries, enquiry(5, 'Ehlers', '2026-11-20')])
    renderWithProviders(<VisitReminders employeeId={4} version={0} onPlan={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: '2 neue Anfragen' }))
    const dialog = await screen.findByRole('dialog', { name: 'Neue Anfragen seit Ihrem letzten Besuch' })
    expect(within(dialog).getByText('Christ')).toBeInTheDocument()
    expect(within(dialog).getByText('Ehlers')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gesehen' }))
    expect(screen.queryByRole('button', { name: '2 neue Anfragen' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('wego.visits.seen.4')!)).toEqual([1, 2, 3, 4, 5])
  })
})
