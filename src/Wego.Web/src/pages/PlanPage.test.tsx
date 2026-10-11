import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Plan } from '../api/types'
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
  ],
}

function entry(id: number, employeeId: number, date: string, customerName: string, start: string | null, end: string | null) {
  return {
    id,
    employeeId,
    employeeName: '',
    date,
    type: 'Baustelle' as const,
    customerId: 10,
    customerName,
    startTime: start,
    endTime: end,
    note: null,
  }
}

function mockPlan() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(plan), { status: 200 })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('PlanPage', () => {
  it('shows a split day with its time windows and the school holidays', async () => {
    mockPlan()
    render(<PlanPage year={2026} canEdit={false} />)

    const row = (await screen.findByText('Mo 02.03.')).closest('tr')!
    expect(within(row).getByText('Familie Schulze')).toBeInTheDocument()
    expect(within(row).getByText('8–10 Uhr')).toBeInTheDocument()
    expect(within(row).getByText('11–13 Uhr')).toBeInTheDocument()

    expect(screen.getAllByText('Winterferien')).toHaveLength(6)
    expect(screen.queryByRole('button', { name: /bearbeiten/ })).not.toBeInTheDocument()
  })

  it('reduces the plan to the days of the filtered customer', async () => {
    mockPlan()
    render(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText('Mo 02.03.')

    await userEvent.type(screen.getByLabelText(/Nach Baustelle/), 'schulze')

    expect(screen.getByText('Mo 02.03.')).toBeInTheDocument()
    expect(screen.queryByText('Di 03.03.')).not.toBeInTheDocument()
    expect(screen.getByText(/1 Tag mit Einsätzen/)).toBeInTheDocument()
  })

  it('lets planners open a day for editing', async () => {
    mockPlan()
    render(<PlanPage year={2026} canEdit />)
    await screen.findByText('Mo 02.03.')

    expect(screen.getAllByRole('button', { name: /bearbeiten/ }).length).toBe(730)
  })
})
