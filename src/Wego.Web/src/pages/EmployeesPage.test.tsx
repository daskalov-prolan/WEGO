import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Employee } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { EmployeesPage } from './EmployeesPage'

const employee = (id: number, name: string, isActive: boolean, patch: Partial<Employee> = {}): Employee => ({
  id, name, sortOrder: id, isActive, showInPlan: true, vacationDaysPerYear: 30, userName: null, role: 'Handwerker',
  hasPassword: false, mainActivity: null, additionalActivities: [], ...patch,
})

const employees = [
  employee(1, 'Anna', true, { hourlyRate: 38.5, phone: '0170 123 45' }),
  employee(2, 'Bernd', true),
  employee(3, 'Carla', false),
  // A planner who works on the sites as well.
  employee(4, 'Paul', true, { role: 'PlanerA', showInPlan: true }),
  employee(5, 'Petra', true, { role: 'PlanerG', showInPlan: false }),
]

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(employees), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EmployeesPage', () => {
  it('shows a deleted employee at the end as such, not to be opened', async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify([...employees, employee(9, 'Dieter', false, { isDeleted: true })]), { status: 200 }))
    renderWithProviders(<EmployeesPage canEdit />)
    await screen.findByRole('link', { name: 'Anna' })
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.at(-1)!.textContent).toContain('Dieter')
    expect(rows.at(-1)!.textContent).toContain('gelöscht')
    expect(screen.queryByRole('link', { name: 'Dieter' })).not.toBeInTheDocument()
  })

  it('lists the active employees for Planer G with their wage, and opens one in the administration', async () => {
    const user = userEvent.setup()
    renderWithProviders(<EmployeesPage canEdit />)
    expect(await screen.findByRole('link', { name: 'Anna' })).toHaveAttribute('href', '#/verwaltung/1')
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Rolle',
      'Name',
      'Telefon',
      'Geburtstag',
      'Stundensatz',
    ])
    expect(screen.getByText('38,50 €/Std.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '0170 123 45' })).toHaveAttribute('href', 'tel:017012345')
    // No activities any more; the inactive ones only when asked for.
    expect(screen.queryByTitle('Haupttätigkeit')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Carla' })).not.toBeInTheDocument()

    const choose = async (label: string) => {
      await user.click(screen.getAllByLabelText('Anzeigen').find((element) => element.tagName === 'INPUT')!)
      await user.click(await screen.findByRole('option', { name: label, hidden: true }))
    }
    await choose('Inaktive Mitarbeiter')
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Carla'])
    // Planners, and the craftsmen with a planner who works on the sites as well.
    await choose('Planer')
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Paul', 'Petra'])
    await choose('Handwerker')
    expect(screen.getAllByRole('link').filter((link) => !link.textContent?.startsWith('0')).map((link) => link.textContent)).toEqual([
      'Anna',
      'Bernd',
      'Paul',
    ])
    await choose('Alle Mitarbeiter')

    await user.type(screen.getByRole('textbox', { name: 'Mitarbeiter suchen' }), 'ber')
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Bernd'])

    await user.click(screen.getByText('Bernd').closest('tr')!)
    expect(window.location.hash).toBe('#/verwaltung/2')
  })

  it('shows the list to everybody else: telephone, but no wage and nothing to open', async () => {
    window.location.hash = ''
    const user = userEvent.setup()
    renderWithProviders(<EmployeesPage />)
    expect(await screen.findByText('Anna')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/employees/overview', expect.anything())
    expect(screen.queryByRole('link', { name: 'Anna' })).not.toBeInTheDocument()
    expect(screen.queryByText('Stundensatz')).not.toBeInTheDocument()

    await user.click(screen.getByText('Bernd').closest('tr')!)
    expect(window.location.hash).toBe('')
  })
})
