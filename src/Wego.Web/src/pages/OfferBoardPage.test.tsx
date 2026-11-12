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
  sites: [site(1, 'Neu'), site(2, 'Besichtigt'), site(3, 'Geplant'), site(4, 'Übergeben'), { ...site(5, 'Ausgewählt'), clientPhone: '030 123 45' }],
  steps: [
    step(2, 'Besichtigung', '2026-11-05'),
    step(3, 'Besichtigung', '2026-11-20'),
    step(4, 'Besichtigung', '2026-10-01'),
    step(4, 'Objektauswahl', '2026-10-10'),
    step(4, 'Angebotsuebergabe', '2026-10-20'),
    step(5, 'Besichtigung', '2026-10-01'),
    step(5, 'Objektauswahl', '2026-10-08'),
  ],
  stepActivities: ['Besichtigung', 'Objektauswahl', 'Angebotsuebergabe'],
  decided: [],
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
  it('puts each enquiry in the column of its step: the next to plan, or the one planned ahead', async () => {
    renderWithProviders(<OfferBoardPage />)
    await screen.findByText('Neu')
    expect(within(column('Anfrage')).getByText('Neu')).toBeInTheDocument()
    // Besichtigt (its day has passed): the Objektauswahl comes next.
    expect(within(column('Objektauswahl')).getByText('Besichtigt')).toBeInTheDocument()
    expect(within(column('Objektauswahl')).getByRole('button', { name: 'Objektauswahl planen' })).toBeInTheDocument()
    // Planned ahead: stays with its step, can be moved.
    expect(within(column('Besichtigung')).getByText('Geplant')).toBeInTheDocument()
    expect(within(column('Besichtigung')).getByRole('button', { name: 'Termin verschieben' })).toBeInTheDocument()
    // Handed over: yes or no.
    expect(within(column('Wartet auf Zusage')).getByRole('button', { name: 'Zusage' })).toBeInTheDocument()
  })

  it('opens the enquiry from its card, calls the customer, and plans a second Objektauswahl', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<OfferBoardPage />)
    const card = (await screen.findByText('Ausgewählt')).closest('article')!
    expect(within(card).getByRole('link', { name: /030 123 45/ })).toHaveAttribute('href', 'tel:03012345')
    // Until the Angebotsübergabe is planned, the Objektauswahl may get another appointment.
    expect(within(card).getByRole('button', { name: '+ weitere Objektauswahl' })).toBeInTheDocument()
    expect(within(column('Wartet auf Zusage')).queryByRole('button', { name: /weitere/ })).not.toBeInTheDocument()
    await user.click(within(card).getByText(/^Anfrage .*02.11./))
    expect(await screen.findByText('Anfrage · Ausgewählt')).toBeInTheDocument()
  })

  it('asks the reason when a customer says no', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<OfferBoardPage />)
    await screen.findByText('Neu')
    await user.click(within(column('Anfrage')).getByRole('button', { name: 'Kunde hat abgesagt' }))
    const dialog = await screen.findByRole('dialog')
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
