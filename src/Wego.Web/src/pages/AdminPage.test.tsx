import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { Plan } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { SchoolHolidaysSection } from './AdminPage'

const plan = {
  year: 2027, employees: [], sites: [], entries: [], notes: [],
  schoolHolidays: [
    { id: 5, name: 'Betriebsferien', kind: 'Betriebsferien', startDate: '2027-12-20', endDate: '2027-12-31' },
    { id: 6, name: 'Sommerferien', kind: 'Schulferien', startDate: '2027-07-01', endDate: '2027-08-14' },
  ],
} as unknown as Plan

afterEach(() => vi.restoreAllMocks())

describe('SchoolHolidaysSection', () => {
  it('changes the name of Betriebsferien, and only they can be changed', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'plan').mockResolvedValue(plan)
    const update = vi.spyOn(api, 'updateSchoolHoliday').mockResolvedValue(plan.schoolHolidays[0])
    renderWithProviders(<SchoolHolidaysSection year={2027} />)

    const closure = (await screen.findByText('Betriebsferien', { selector: 'td' })).closest('tr')!
    const summer = screen.getByText('Sommerferien').closest('tr')!
    expect(within(summer).queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument()

    await user.click(within(closure).getByRole('button', { name: 'Bearbeiten' }))
    const sheet = await screen.findByRole('dialog')
    const name = within(sheet).getByRole('textbox', { name: 'Bezeichnung' })
    await user.clear(name)
    await user.type(name, 'Winterpause')
    await user.click(within(sheet).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith(5, 'Winterpause', '2027-12-20', '2027-12-31', 'Betriebsferien'))
  })
})
