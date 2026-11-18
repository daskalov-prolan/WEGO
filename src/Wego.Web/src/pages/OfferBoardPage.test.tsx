import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Offers, OfferStep, Site } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { OfferBoardPage } from './OfferBoardPage'

function site(id: number, name: string): Site {
  return {
    id, name, client: name, street: null, houseNumber: null, addressAddition: null, postalCode: null, city: null,
    nameSource: 'Auftraggeber', description: null, plannedStart: null, plannedEnd: null, status: 'Angebot', tasks: [],
    labelProjectNumber: null, clientPhone: null, requestedOn: '2026-11-02', scope: ['Gäste-WC'], responsiblePlannerId: 9,
  }
}

const step = (siteId: number, activity: OfferStep['activity'], date: string): OfferStep => ({
  siteId, activity, entryId: siteId * 10, employeeId: 4, employeeName: 'Stefan', date, startTime: '09:00:00', endTime: '10:00:00',
})

const offers: Offers = {
  sites: [
    site(7, 'Später übergeben'), site(1, 'Neu'), site(2, 'Besichtigt'), site(3, 'Geplant'), site(4, 'Übergeben'), { ...site(5, 'Ausgewählt'), clientPhone: '030 123 45' },
    site(6, 'Früh ausgewählt'), site(8, 'Auswahl geplant'),
  ],
  steps: [
    step(2, 'Besichtigung', '2026-11-05'),
    step(3, 'Besichtigung', '2026-11-20'),
    step(4, 'Besichtigung', '2026-10-01'),
    step(4, 'Objektauswahl', '2026-10-10'),
    step(4, 'Angebotsuebergabe', '2026-10-20'),
    step(5, 'Besichtigung', '2026-10-01'),
    step(5, 'Objektauswahl', '2026-10-08'),
    // The Objektauswahl planned already while the visit is still ahead.
    step(6, 'Besichtigung', '2026-11-19'),
    step(6, 'Objektauswahl', '2026-11-30'),
    // Visited, the Objektauswahl ahead: in its column.
    { ...step(8, 'Besichtigung', '2026-11-04'), employeeName: 'Stefan Buder' },
    step(8, 'Objektauswahl', '2026-11-25'),
    // Listed first, but handed over after Übergeben.
    { ...step(7, 'Besichtigung', '2026-10-02'), entryId: 71 },
    { ...step(7, 'Objektauswahl', '2026-10-09'), entryId: 72 },
    { ...step(7, 'Angebotsuebergabe', '2026-10-25'), entryId: 73 },
  ],
  stepActivities: ['Besichtigung', 'Objektauswahl', 'Angebotsuebergabe'],
  decided: [],
  // Stefan reported on the telephone that this customer says no.
  reports: [{ siteId: 2, reason: 'Kein Interesse mehr', note: 'baut nicht mehr um', by: 'Stefan', at: '2026-11-10T09:00:00Z' }],
}

let declined: unknown = null

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-11T09:00:00') })
  declined = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/sites/planners') return new Response(JSON.stringify([{ id: 9, name: 'Marina', isMe: true }]), { status: 200 })
      if (url.startsWith('/api/plan')) return new Response(JSON.stringify({ employees: [], planners: [], entries: [], sites: [], schoolHolidays: [] }), { status: 200 })
      if (url.endsWith('/decline-reasons'))
        return new Response(JSON.stringify({ step: 'Objektauswahl', reasons: ['Zu lange gewartet', 'Kein Interesse mehr', 'Sonstiges'] }), { status: 200 })
      if (url.endsWith('/decline')) {
        declined = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ ...offers, sites: offers.sites.filter((s) => s.id !== 1) }), { status: 200 })
      }
      return new Response(JSON.stringify(offers), { status: 200 })
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const column = (name: string) => screen.getByRole('region', { name })

describe('OfferBoardPage', () => {
  it('names who visited by his initials, so that the planners know whom to ask', async () => {
    renderWithProviders(<OfferBoardPage />)
    const who = await within(await screen.findByRole('region', { name: 'Objektauswahl' })).findByTitle('Stefan Buder')
    expect(who).toHaveTextContent('· SB')
  })

  it('puts each enquiry in the column of its step: the next to plan, or the one planned ahead', async () => {
    renderWithProviders(<OfferBoardPage />)
    await screen.findByText('Neu')
    expect(within(column('Anfrage')).getByText('Neu')).toBeInTheDocument()
    // Besichtigt (its day has passed): the Objektauswahl comes next.
    expect(within(column('Objektauswahl')).getByText('Besichtigt')).toBeInTheDocument()
    expect(within(column('Objektauswahl')).getByRole('button', { name: 'Objektauswahl planen' })).toBeInTheDocument()
    // Planned ahead: stays with its step, can be moved.
    expect(within(column('Besichtigung')).getByText('Geplant')).toBeInTheDocument()
    expect(within(screen.getByText('Geplant').closest('article')!).getByRole('button', { name: 'Termin verschieben' })).toBeInTheDocument()
    // The next visit on top, whatever the date of the enquiry: Früh ausgewählt (19.11.) before Geplant (20.11.).
    const names = within(column('Besichtigung')).getAllByRole('article').map((card) => card.textContent ?? '')
    expect(names.findIndex((text) => text.includes('Früh ausgewählt'))).toBeLessThan(names.findIndex((text) => text.includes('Geplant')))
    // Waiting for the yes: the offer handed over longest ago on top.
    const waiting = within(column('Wartet auf Zusage')).getAllByRole('article').map((card) => card.textContent ?? '')
    expect(waiting.findIndex((text) => text.includes('Übergeben'))).toBeLessThan(waiting.findIndex((text) => text.includes('Später übergeben')))
    // Handed over: yes or no.
    expect(within(column('Wartet auf Zusage')).getAllByRole('button', { name: 'Zusage' })).toHaveLength(2)
  })

  it('opens the enquiry from its card, calls the customer, and plans a second Objektauswahl', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<OfferBoardPage />)
    const card = (await screen.findByText('Ausgewählt')).closest('article')!
    expect(within(card).getByRole('link', { name: /030 123 45/ })).toHaveAttribute('href', 'tel:03012345')
    // The planner in charge, changed from the card.
    expect(within(card).getByText('Marina')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Zuständigen Planer für Ausgewählt ändern' })).toBeInTheDocument()
    // In the column of the Objektauswahl it may get another appointment; moved on to the Angebotsübergabe no longer.
    const choosing = screen.getByText('Auswahl geplant').closest('article')!
    expect(within(column('Objektauswahl')).getByText('Auswahl geplant')).toBeInTheDocument()
    expect(within(choosing).getByRole('button', { name: '+ weitere Objektauswahl' })).toBeInTheDocument()
    expect(within(column('Angebotsübergabe')).getByText('Ausgewählt')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /weitere/ })).not.toBeInTheDocument()
    expect(within(column('Wartet auf Zusage')).queryByRole('button', { name: /weitere/ })).not.toBeInTheDocument()
    // Not before the card has come to the Objektauswahl: the visit is still ahead.
    const early = screen.getByText('Früh ausgewählt').closest('article')!
    expect(within(column('Besichtigung')).getByText('Früh ausgewählt')).toBeInTheDocument()
    expect(within(early).queryByRole('button', { name: /weitere/ })).not.toBeInTheDocument()
    await user.click(within(card).getByText(/^Anfrage .*02.11./))
    expect(await screen.findByText('Anfrage · Ausgewählt')).toBeInTheDocument()
  })

  it('shows a no reported by who visits on the card, for the planner to confirm with its reason', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<OfferBoardPage />)
    const card = (await screen.findByText('Besichtigt')).closest('article')!
    expect(card.querySelector('.offer-report')!.textContent).toContain('Absage gemeldet von Stefan: Kein Interesse mehr (baut nicht mehr um)')
    // Saying no is part of planning an appointment, not of the card.
    expect(screen.queryByRole('button', { name: 'Kunde sagt ab' })).not.toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Absage bestätigen' }))
    const dialog = await screen.findByRole('dialog', { name: /Abgelehnt · Besichtigt/ })
    expect(await within(dialog).findByText(/bei der Objektauswahl/)).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'Kein Interesse mehr' })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Abgelehnt' }))
    await waitFor(() => expect(declined).toEqual({ reason: 'Kein Interesse mehr', note: 'baut nicht mehr um' }))
  })

  it('takes the no of the customer while planning an appointment, with the reasons of that step', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<OfferBoardPage />)
    const card = (await screen.findByText('Geplant')).closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Termin verschieben' }))
    await user.click(await screen.findByRole('button', { name: 'Kunde sagt ab' }))
    const dialog = await screen.findByRole('dialog', { name: /Abgelehnt · Geplant/ })
    expect(await within(dialog).findByRole('radio', { name: 'Zu lange gewartet' })).toBeInTheDocument()
  })

  it('asks the reason when a customer says no', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<OfferBoardPage />)
    await screen.findByText('Neu')
    // From the enquiry window, opened by a click on the card.
    await user.click(within(column('Anfrage')).getByRole('button', { name: 'Neu' }))
    await user.click(await screen.findByRole('button', { name: 'Kunde sagt ab' }))
    const dialog = await screen.findByRole('dialog', { name: /Abgelehnt/ })
    const save = within(dialog).getByRole('button', { name: 'Abgelehnt' })
    expect(save).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Sonstiges' }))
    // "Sonstiges" needs a few words.
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('Bemerkung'), 'zieht um')
    await user.click(save)
    await waitFor(() => expect(declined).toEqual({ reason: 'Sonstiges', note: 'zieht um' }))
  })
})
