import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, Plan, Site } from '../api/types'
import { byText, renderWithProviders } from '../test-utils'
import { EmployeeMiniPlan } from './EmployeeMiniPlan'

const site = (id: number, name: string, plannedStart: string | null, tasks: Site['tasks']): Site => ({
  id, name, client: name, labelProjectNumber: null, clientPhone: null, street: null, houseNumber: null, addressAddition: null,
  postalCode: null, city: null, nameSource: 'Auftraggeber', description: null, plannedStart, plannedEnd: null,
  status: 'Bauphase', tasks,
})
const open = (activity: Site['tasks'][number]['activity']) => ({ activity, estimatedDays: 1, notNeeded: false })

function entry(id: number, date: string, siteId: number, siteName: string): Entry {
  return {
    id, employeeId: 2, employeeName: 'Bernd', date, type: 'Baustelle', siteId, siteName, activity: 'Fliesen',
    startTime: null, endTime: null, note: null, noteImportant: false,
  }
}

const plan: Plan = {
  year: 2026,
  employees: [
    { id: 1, name: 'Anna', mainActivity: 'Abriss', additionalActivities: [] },
    // Bernd lays tiles, and does Abriss besides.
    { id: 2, name: 'Bernd', mainActivity: 'Fliesen', additionalActivities: ['Abriss'] },
  ],
  sites: [
    site(10, 'Abriss früh', '2026-02-01', [open('Abriss')]),
    site(11, 'Fliesen spät', '2026-05-01', [open('Fliesen')]),
    site(12, 'Fliesen früh', '2026-04-01', [open('Fliesen'), open('Sanitaer')]),
    site(13, 'Meier', null, []),
  ],
  schoolHolidays: [],
  // Bernd works in KW 10 and KW 11; KW 12 is free.
  entries: [entry(1, '2026-03-03', 13, 'Meier'), entry(2, '2026-03-10', 13, 'Meier'), entry(3, '2026-03-04', 11, 'Fliesen spät')],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-02T09:00:00') })
  fetchMock = vi.fn(async (url: string) =>
    url === '/api/plan/batch' ? new Response('[]', { status: 200 }) : new Response(JSON.stringify(plan), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const batch = () => {
  const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')
  return call ? JSON.parse(String(call[1].body)) : null
}

const laneNames = () => [...document.querySelectorAll('.mini-lane-name .name')].map((name) => name.textContent)

describe('EmployeeMiniPlan', () => {
  it('has a lane per site the employee works on in the weeks in view, without open activities', async () => {
    renderWithProviders(<EmployeeMiniPlan employeeId={2} canEdit />)
    await screen.findByText(byText('KW 10 · ab 02.03.'))
    expect(laneNames()).toEqual(['Meier', 'Fliesen spät'])
    // No boxes of open activities at the sites.
    expect(within(document.querySelector('.mini-lane-name.site-lane') as HTMLElement).queryAllByRole('button')).toEqual([])
  })

  it('opens at the current week with only the calendar week above it, and jumps to the next free week', async () => {
    const user = userEvent.setup()
    renderWithProviders(<EmployeeMiniPlan employeeId={2} canEdit />)
    expect(await screen.findByText(byText('KW 10 · ab 02.03.'))).toBeInTheDocument()
    expect(screen.getAllByText(byText('KW 10')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Meier, 2026-03-03' })).getAllByText('Bernd').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /Nächste freie Woche/ }))
    expect(screen.getByText(byText('KW 12 · ab 16.03.'))).toBeInTheDocument()
  })

  it('moves an entry to another day and site by dragging it', async () => {
    renderWithProviders(<EmployeeMiniPlan employeeId={2} canEdit />)
    const tuesday = await screen.findByRole('button', { name: 'Meier, 2026-03-03' })
    const chip = within(tuesday).getAllByText('Bernd')[0].closest('.chip')!
    fireEvent.dragStart(chip)
    expect(fireEvent.dragOver(tuesday)).toBe(true)
    const target = screen.getByRole('button', { name: 'Fliesen spät, 2026-03-05' })
    expect(fireEvent.dragOver(target)).toBe(false)
    fireEvent.drop(target)
    fireEvent.dragEnd(chip)
    await waitFor(() => expect(batch()).not.toBeNull())
    expect(batch()).toEqual([
      { employeeId: 2, date: '2026-03-03', entries: [] },
      { employeeId: 2, date: '2026-03-05', entries: [expect.objectContaining({ siteId: 11, activity: 'Fliesen' })] },
    ])
  })

  it('follows the activity filter: only sites with those activities', async () => {
    renderWithProviders(<EmployeeMiniPlan employeeId={2} canEdit activityFilter={new Set(['Abriss'])} />)
    await screen.findByText(byText('KW 10 · ab 02.03.'))
    // Bernd only lays tiles in these weeks.
    expect(laneNames()).toEqual([])
  })
})
