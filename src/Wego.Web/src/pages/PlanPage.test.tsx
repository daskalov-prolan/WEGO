import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, Plan } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { PlanPage } from './PlanPage'

const plan: Plan = {
  year: 2026,
  employees: [
    { id: 1, name: 'Anna', mainActivity: null, additionalActivities: [] },
    { id: 2, name: 'Bernd', mainActivity: 'Sanitaer', additionalActivities: ['Abriss'] },
  ],
  customers: [
    { id: 10, name: 'Familie Schulze', location: null, description: null },
    { id: 11, name: 'Familie Meier', location: null, description: null },
  ],
  schoolHolidays: [
    { id: 5, name: 'Winterferien', kind: 'Schulferien', startDate: '2026-02-02', endDate: '2026-02-07' },
    { id: 6, name: 'Frauentag', kind: 'Feiertag', startDate: '2026-03-08', endDate: '2026-03-08' },
  ],
  entries: [
    entry(1, 1, '2026-03-02', 10, 'Familie Schulze', '08:00:00', '10:00:00'),
    entry(2, 1, '2026-03-02', 11, 'Familie Meier', '11:00:00', '13:00:00'),
    entry(3, 2, '2026-03-03', 11, 'Familie Meier', null, null),
    entry(4, 2, '2026-03-12', 10, 'Familie Schulze', null, null),
  ],
}

function entry(id: number, employeeId: number, date: string, customerId: number, customerName: string, start: string | null, end: string | null): Entry {
  return {
    id, employeeId, employeeName: '', date, type: 'Baustelle', customerId, customerName, activity: null,
    startTime: start, endTime: end, note: null,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-02T09:00:00') })
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/plan/batch') {
      const days = JSON.parse(String(init?.body)) as { employeeId: number; date: string; entries: { type: string; activity: string | null }[] }[]
      const saved = days.flatMap((day, index) =>
        day.entries.map((e) => ({ ...entry(100 + index, day.employeeId, day.date, 0, '', null, null), type: e.type, customerId: null, customerName: null })),
      )
      return new Response(JSON.stringify(saved), { status: 200 })
    }
    return new Response(JSON.stringify(plan), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const cell = (label: RegExp) => screen.getByRole('button', { name: label })

describe('PlanPage', () => {
  it('starts with the current week: days in rows, employees in columns, a split day with its time windows', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)

    expect(await screen.findByText('KW 10 · 02.03.–08.03.2026')).toBeInTheDocument()
    const monday = cell(/Anna, Montag, 02.03.2026/)
    expect(within(monday).getByText('8–10 Uhr')).toBeInTheDocument()
    expect(within(monday).getByText('11–13 Uhr')).toBeInTheDocument()
    // The short form for narrow screens names the first site and counts the rest.
    expect(within(monday).getByText('+1')).toBeInTheDocument()

    const header = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(header).toEqual(['Tag', 'Anna', 'Bernd'])
    const firstRow = screen.getAllByRole('row')[1]
    expect(within(firstRow).getByRole('rowheader')).toHaveTextContent('Mo 02.03.')
  })

  it('moves by week and by month', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    expect(screen.getByText('KW 11 · 09.03.–15.03.2026')).toBeInTheDocument()
    expect(within(cell(/Bernd, Donnerstag, 12.03.2026/)).getAllByText('Familie Schulze')).not.toHaveLength(0)

    await userEvent.click(screen.getByRole('radio', { name: 'Monat' }))
    expect(screen.getByText('März 2026')).toBeInTheDocument()
    expect(within(cell(/Anna, Montag, 02.03.2026/)).getAllByText('Familie Meier')).not.toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(screen.getByText('Februar 2026')).toBeInTheDocument()
    expect(screen.getAllByTitle('Winterferien').length).toBeGreaterThan(0)
  })

  it('dims everything but the filtered customer', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await userEvent.type(screen.getByLabelText(/Nach Baustelle/), 'schulze')

    const monday = cell(/Anna, Montag, 02.03.2026/)
    expect(within(monday).getAllByText('Familie Schulze')[0].closest('.chip')).not.toHaveClass('dimmed')
    expect(within(monday).getByText('Familie Meier').closest('.chip')).toHaveClass('dimmed')
    expect(screen.getByText(/2 Tage mit Einsätzen in 2026/)).toBeInTheDocument()
  })

  it('shows the year as in the Excel sheet', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await userEvent.click(screen.getByRole('radio', { name: 'Jahr' }))

    const row = document.getElementById('d-2026-03-02')!
    expect(within(row).getAllByText('Familie Schulze')).not.toHaveLength(0)
    expect(screen.getAllByText('Winterferien')).toHaveLength(6)
    expect(document.getElementById('d-2026-03-08')).toHaveClass('public-holiday')
    expect(document.getElementById('d-2026-02-03')).toHaveClass('holiday')
  })

  it('opens a read-only day for employees and the editor for planners', async () => {
    const { unmount } = renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await userEvent.click(await screen.findByRole('button', { name: /Anna, Montag, 02.03.2026/ }))
    expect(await screen.findByRole('button', { name: 'Schließen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()
    unmount()

    renderWithProviders(<PlanPage year={2026} canEdit />)
    await userEvent.click(await screen.findByRole('button', { name: /Anna, Montag, 02.03.2026/ }))
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeInTheDocument()
  })

  it('starts a site entry with the main activity and offers only the activities of the employee', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await user.click(await screen.findByRole('button', { name: /Bernd, Mittwoch, 04.03.2026/ }))

    const input = (label: RegExp) => screen.getAllByLabelText(label).find((element) => element.tagName === 'INPUT')!
    await screen.findAllByLabelText(/^Kunde/)
    await user.type(input(/^Kunde/), 'Familie Schulze')
    expect(input(/^Tätigkeit/)).toHaveValue('Sanitär (Haupttätigkeit)')
    await user.click(input(/^Tätigkeit/))
    // The customer suggestions of the field above are options too.
    const options = (await screen.findAllByRole('option', { hidden: true }))
      .map((option) => option.textContent)
      .filter((text) => !text?.startsWith('Familie'))
    expect(options).toEqual(['Sanitär (Haupttätigkeit)', 'Abriss / Baubeginn'])
    await user.click(await screen.findByRole('option', { name: 'Abriss / Baubeginn', hidden: true }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))[0].entries).toEqual([
      expect.objectContaining({ type: 'Baustelle', customerName: 'Familie Schulze', activity: 'Abriss' }),
    ])
  })
  it('lets planners select several cells and fill them in one go', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)

    await user.keyboard('{Control>}')
    await user.click(cell(/Bernd, Mittwoch, 04.03.2026/))
    await user.click(cell(/Bernd, Donnerstag, 05.03.2026/))
    await user.keyboard('{/Control}')

    expect(screen.getByText('2 Felder ausgewählt')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Urlaub' }))

    await waitFor(() => expect(within(cell(/Bernd, Mittwoch, 04.03.2026/)).getAllByText('Urlaub')).not.toHaveLength(0))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))).toEqual([
      expect.objectContaining({ employeeId: 2, date: '2026-03-04', entries: [expect.objectContaining({ type: 'Urlaub' })] }),
      expect.objectContaining({ employeeId: 2, date: '2026-03-05', entries: [expect.objectContaining({ type: 'Urlaub' })] }),
    ])
    expect(await screen.findByRole('button', { name: 'Rückgängig' })).toBeInTheDocument()
    expect(screen.queryByText('2 Felder ausgewählt')).not.toBeInTheDocument()
  })
})
