import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, Plan } from '../api/types'
import { PlanPage } from './PlanPage'

const plan: Plan = {
  year: 2026,
  employees: [
    { id: 1, name: 'Anna' },
    { id: 2, name: 'Bernd' },
  ],
  customers: [
    { id: 10, name: 'Familie Schulze', location: null, description: null },
    { id: 11, name: 'Familie Meier', location: null, description: null },
  ],
  schoolHolidays: [{ id: 5, name: 'Winterferien', startDate: '2026-02-02', endDate: '2026-02-07' }],
  entries: [
    entry(1, 1, '2026-03-02', 'Familie Schulze', '08:00:00', '10:00:00'),
    entry(2, 1, '2026-03-02', 'Familie Meier', '11:00:00', '13:00:00'),
    entry(3, 2, '2026-03-03', 'Familie Meier', null, null),
    entry(4, 2, '2026-03-12', 'Familie Schulze', null, null),
  ],
}

function entry(id: number, employeeId: number, date: string, customerName: string, start: string | null, end: string | null): Entry {
  return {
    id, employeeId, employeeName: '', date, type: 'Baustelle', customerId: 10, customerName,
    startTime: start, endTime: end, note: null,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-02T09:00:00') })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(plan), { status: 200 })),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const cell = (label: RegExp) => screen.getByRole('button', { name: label })

describe('PlanPage', () => {
  it('starts with the current week: employees in rows, a split day with its time windows', async () => {
    render(<PlanPage year={2026} canEdit={false} />)

    expect(await screen.findByText('KW 10 · 02.03.–08.03.2026')).toBeInTheDocument()
    const monday = cell(/Anna, Montag, 02.03.2026/)
    expect(within(monday).getByText('8–10 Uhr')).toBeInTheDocument()
    expect(within(monday).getByText('11–13 Uhr')).toBeInTheDocument()
    // The short form for narrow screens names the first site and counts the rest.
    expect(within(monday).getByText('+1')).toBeInTheDocument()
    expect(within(cell(/Bernd, Dienstag, 03.03.2026/)).getAllByText('Familie Meier')).not.toHaveLength(0)
  })

  it('moves by week and by month', async () => {
    render(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    expect(screen.getByText('KW 11 · 09.03.–15.03.2026')).toBeInTheDocument()
    expect(within(cell(/Bernd, Donnerstag, 12.03.2026/)).getAllByText('Familie Schulze')).not.toHaveLength(0)

    await userEvent.click(screen.getByRole('tab', { name: 'Monat' }))
    expect(screen.getByText('März 2026')).toBeInTheDocument()
    expect(cell(/Anna, Montag, 02.03.2026: Familie Schulze \/ Familie Meier/)).toHaveTextContent('Fam2')

    await userEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(screen.getByText('Februar 2026')).toBeInTheDocument()
    expect(screen.getAllByTitle('Winterferien').length).toBeGreaterThan(0)
  })

  it('dims everything but the filtered customer', async () => {
    render(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await userEvent.type(screen.getByLabelText(/Nach Baustelle/), 'schulze')

    const monday = cell(/Anna, Montag, 02.03.2026/)
    expect(within(monday).getAllByText('Familie Schulze')[0].closest('.chip')).not.toHaveClass('dimmed')
    expect(within(monday).getByText('Familie Meier').closest('.chip')).toHaveClass('dimmed')
    expect(screen.getByText(/2 Tage mit Einsätzen in 2026/)).toBeInTheDocument()
  })

  it('hides employees on request and remembers it', async () => {
    const { unmount } = render(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await userEvent.click(screen.getByLabelText('Bernd'))
    expect(screen.queryByRole('button', { name: /Bernd, Montag/ })).not.toBeInTheDocument()
    expect(screen.getByText('Mitarbeiter (1/2)')).toBeInTheDocument()

    unmount()
    render(<PlanPage year={2026} canEdit={false} />)
    expect(await screen.findByText('Mitarbeiter (1/2)')).toBeInTheDocument()
  })

  it('shows the year as in the Excel sheet', async () => {
    render(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await userEvent.click(screen.getByRole('tab', { name: 'Jahr' }))

    const row = screen.getByText('Mo 02.03.').closest('tr')!
    expect(within(row).getByText('Familie Schulze')).toBeInTheDocument()
    expect(screen.getAllByText('Winterferien')).toHaveLength(6)
  })

  it('opens a read-only day for employees and the editor for planners', async () => {
    const { unmount } = render(<PlanPage year={2026} canEdit={false} />)
    await userEvent.click(await screen.findByRole('button', { name: /Anna, Montag, 02.03.2026/ }))
    expect(screen.getByRole('button', { name: 'Schließen', hidden: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Speichern', hidden: true })).not.toBeInTheDocument()
    unmount()

    render(<PlanPage year={2026} canEdit />)
    await userEvent.click(await screen.findByRole('button', { name: /Anna, Montag, 02.03.2026/ }))
    expect(screen.getByRole('button', { name: 'Speichern', hidden: true })).toBeInTheDocument()
  })
})
