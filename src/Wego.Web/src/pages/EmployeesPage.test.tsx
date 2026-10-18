import { screen } from '@testing-library/react'
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

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(employees), { status: 200 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EmployeesPage', () => {
  it('lists the active employees with their activities and opens one', async () => {
    const user = userEvent.setup()
    renderWithProviders(<EmployeesPage />)
    expect(await screen.findByRole('link', { name: 'Anna' })).toHaveAttribute('href', '#/mitarbeiter/1')
    expect(screen.getByText('Abriss / Baubeginn')).toBeInTheDocument()
    expect(screen.getByText('Trockenbau')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Carla' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Nur aktive' }))
    expect(screen.getByRole('link', { name: 'Carla' })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Mitarbeiter suchen' }), 'ber')
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Bernd'])

    await user.click(screen.getByText('Bernd').closest('tr')!)
    expect(window.location.hash).toBe('#/mitarbeiter/2')
  })
})
