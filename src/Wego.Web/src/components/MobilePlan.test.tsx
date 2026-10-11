import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Entry } from '../api/types'
import { MobilePlan } from './MobilePlan'

const employees = [
  { id: 1, name: 'Anna' },
  { id: 2, name: 'Bernd' },
]

const entries: Entry[] = [
  entry(1, 1, '2026-03-02', 'Familie Schulze', '08:00:00', '10:00:00'),
  entry(2, 1, '2026-03-02', 'Familie Meier', '11:00:00', '13:00:00'),
  entry(3, 2, '2026-03-04', 'Familie Werner', null, null),
]

function entry(id: number, employeeId: number, date: string, customerName: string, start: string | null, end: string | null): Entry {
  return {
    id, employeeId, employeeName: '', date, type: 'Baustelle', customerId: id, customerName,
    startTime: start, endTime: end, note: null,
  }
}

function renderPlan(props: Partial<Parameters<typeof MobilePlan>[0]> = {}) {
  const onEdit = vi.fn()
  render(
    <MobilePlan
      year={2026}
      employees={employees}
      entriesOf={(employeeId, date) => entries.filter((e) => e.employeeId === employeeId && e.date === date)}
      holidayByDate={new Map([['2026-03-04', 'Testferien']])}
      canEdit={false}
      onEdit={onEdit}
      {...props}
    />,
  )
  return onEdit
}

function goTo(date: string) {
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: date } })
}

describe('MobilePlan', () => {
  it('shows where everybody is on one day, including a split day', async () => {
    renderPlan()
    goTo('2026-03-02')

    expect(screen.getByRole('heading', { name: /Montag, 02.03.2026/ })).toBeInTheDocument()
    const anna = screen.getByText('Anna').closest('.mcard') as HTMLElement
    expect(within(anna).getByText('8–10 Uhr')).toBeInTheDocument()
    expect(within(anna).getByText('Familie Meier')).toBeInTheDocument()
    const bernd = screen.getByText('Bernd').closest('.mcard') as HTMLElement
    expect(within(bernd).getByText('nicht eingeplant')).toBeInTheDocument()
  })

  it('starts with the own week for an employee with a column in the plan', async () => {
    renderPlan({ userId: 2 })
    goTo('2026-03-02')

    expect(screen.getByRole('tab', { name: 'Woche' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Mitarbeiter')).toHaveValue('2')
    const wednesday = screen.getByText('Mittwoch, 04.03.2026').closest('.mcard') as HTMLElement
    expect(within(wednesday).getByText('Familie Werner')).toBeInTheDocument()
    expect(within(wednesday).getByText('Testferien')).toBeInTheDocument()
    expect(screen.queryByText('Familie Schulze')).not.toBeInTheDocument()
  })

  it('lets only planners open a day for editing', async () => {
    const onEdit = renderPlan({ canEdit: true })
    goTo('2026-03-02')

    await userEvent.click(screen.getByRole('button', { name: 'Anna bearbeiten' }))
    expect(onEdit).toHaveBeenCalledWith(employees[0], '2026-03-02')
  })

  it('moves a week at a time and stays inside the year', async () => {
    renderPlan()
    goTo('2026-12-28')

    await userEvent.click(screen.getByRole('button', { name: 'Nächste Woche' }))
    expect(screen.getByLabelText('Datum')).toHaveValue('2026-12-31')
    expect(screen.getByRole('button', { name: 'Freitag, 01.01.2027' })).toBeDisabled()
  })
})
