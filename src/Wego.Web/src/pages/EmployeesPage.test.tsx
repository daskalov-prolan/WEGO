import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Employee } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { EmployeesPage } from './EmployeesPage'

const employee = (id: number, name: string, isActive: boolean, patch: Partial<Employee> = {}): Employee => ({
  id, name, sortOrder: id, isActive, showInPlan: true, vacationDaysPerYear: 30, userName: null, role: 'Mitarbeiter',
  hasPassword: false, mainActivity: null, additionalActivities: [], ...patch,
})

const employees = [
  employee(1, 'Anna', true, { mainActivity: 'Abriss', additionalActivities: ['Trockenbau'] }),
  employee(2, 'Bernd', true),
  employee(3, 'Carla', false),
]

const entry = (id: number, date: string, siteId: number, siteName: string, activity: 'Abriss' | 'Trockenbau') => ({
  id, employeeId: 1, employeeName: 'Anna', date, type: 'Baustelle', siteId, siteName, activity,
  startTime: null, endTime: null, note: null, noteImportant: false,
})
const openSite = { id: 10, name: 'Schulze', status: 'Bauphase', tasks: [] }
const doneSite = { id: 11, name: 'Alt', status: 'Abgeschlossen', tasks: [] }
// Anna: Abriss at Schulze Thu–Mon (a weekend between), then Trockenbau; before today and at a done site nothing counts.
const plan2026 = {
  year: 2026, employees: [], sites: [openSite, doneSite], schoolHolidays: [],
  entries: [
    entry(1, '2026-03-02', 10, 'Schulze', 'Abriss'),
    entry(2, '2026-03-05', 10, 'Schulze', 'Abriss'),
    entry(3, '2026-03-06', 10, 'Schulze', 'Abriss'),
    entry(4, '2026-03-09', 10, 'Schulze', 'Abriss'),
    entry(5, '2026-03-10', 10, 'Schulze', 'Trockenbau'),
    entry(6, '2026-03-11', 11, 'Alt', 'Abriss'),
  ],
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-04T09:00:00') })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/plan?year=2026'
        ? new Response(JSON.stringify(plan2026), { status: 200 })
        : url.startsWith('/api/plan?')
          ? new Response(JSON.stringify({ ...plan2026, entries: [] }), { status: 200 })
          : new Response(JSON.stringify(employees), { status: 200 }),
    ),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('EmployeesPage', () => {
  it('lists the active employees with their activities and opens one', async () => {
    const user = userEvent.setup()
    renderWithProviders(<EmployeesPage />)
    expect(await screen.findByRole('link', { name: 'Anna' })).toHaveAttribute('href', '#/mitarbeiter/1')
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Rolle',
      'Name',
      'Geplant auf offenen Baustellen',
      'Fähigkeiten',
    ])
    // Main activity first and stressed, then the additional ones.
    expect(screen.getByTitle('Haupttätigkeit')).toHaveTextContent('Abriss / Baubeginn')
    expect(screen.getByTitle('Weitere Tätigkeit')).toHaveTextContent('Trockenbau')
    // From today on, at open sites, in stretches.
    const planned = await screen.findByLabelText('Geplant für Anna')
    await waitFor(() =>
      expect([...planned.querySelectorAll('.chip-name')].map((name) => name.textContent)).toEqual([
        '05.03.–09.03.: Schulze',
        '10.03.: Schulze',
      ]),
    )
    expect(screen.queryByRole('link', { name: 'Carla' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Nur aktive' }))
    expect(screen.getByRole('link', { name: 'Carla' })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Mitarbeiter suchen' }), 'ber')
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Bernd'])

    await user.click(screen.getByText('Bernd').closest('tr')!)
    expect(window.location.hash).toBe('#/mitarbeiter/2')
  })
})
