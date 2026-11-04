import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MyVacation, User } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { MyAreaPage } from './MyAreaPage'

const user: User = { id: 3, name: 'Bernd', userName: 'bernd', role: 'Handwerker', showInPlan: true, mustChangePassword: false }

const vacation: MyVacation = {
  year: 2027,
  counted: true,
  countedFrom: 2027,
  entitlement: 30,
  used: 6,
  taken: 1,
  remaining: 24,
  blocks: [
    { from: '2027-01-04', to: '2027-01-04', days: 1 },
    { from: '2027-08-05', to: '2027-08-11', days: 5 },
  ],
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('MyAreaPage', () => {
  it('shows the own vacation from 2027 on: days left and the stretches taken and planned', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-03-01T09:00:00') })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(vacation), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<MyAreaPage user={user} />)

    expect(await screen.findByText('24')).toBeInTheDocument()
    expect(screen.getByText('noch verfügbar')).toBeInTheDocument()
    expect(screen.getByText('verbraucht bzw. eingeplant (davon 1 schon genommen)')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/me/vacation?year=2027', expect.anything())

    const rows = screen.getAllByRole('row').slice(1).map((row) => row.textContent)
    expect(rows).toEqual(['Mo 04.01.20271genommen', 'Do 05.08.2027 – Mi 11.08.20275geplant'])
  })
})
