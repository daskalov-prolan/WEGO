import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, Plan, Site } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { EmployeeMiniPlan } from './EmployeeMiniPlan'

const site = (id: number, name: string, plannedStart: string | null, tasks: Site['tasks']): Site => ({
  id, name, client: name, labelProjectNumber: null, street: null, houseNumber: null, addressAddition: null,
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
  entries: [entry(1, '2026-03-03', 13, 'Meier'), entry(2, '2026-03-10', 13, 'Meier')],
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
  it('has a lane per site: first those worked on, then those with open tasks by main activity and planned start', async () => {
    renderWithProviders(<EmployeeMiniPlan employeeId={2} canEdit />)
    await screen.findByText('KW 10 · ab 02.03.')
    // Sanitär at "Fliesen früh" is nothing Bernd does; the open tasks stand at their site.
    expect(laneNames()).toEqual(['Meier', 'Fliesen früh', 'Fliesen spät', 'Abriss früh'])
    const early = document.querySelectorAll('.mini-lane-name')[1] as HTMLElement
    expect(within(early).getAllByRole('button').map((button) => button.textContent)).toEqual(['Fliesenarbeiten'])
  })

  it('opens at the current week, jumps to the next free week and plans a dragged task on a day of its site', async () => {
    const user = userEvent.setup()
    renderWithProviders(<EmployeeMiniPlan employeeId={2} canEdit />)
    expect(await screen.findByText('KW 10 · ab 02.03.')).toBeInTheDocument()
    expect(screen.getByText('KW 10 · 20 %')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Meier, 2026-03-03' })).getAllByText('Bernd').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /Nächste freie Woche/ }))
    expect(screen.getByText('KW 12 · ab 16.03.')).toBeInTheDocument()

    const lane = document.querySelectorAll('.mini-lane-name')[2] as HTMLElement
    expect(lane.textContent).toContain('Abriss früh')
    const box = within(lane).getByRole('button', { name: 'Abriss / Baubeginn' })
    // Only a day of its own site takes it.
    fireEvent.dragStart(box)
    expect(fireEvent.dragOver(screen.getByRole('button', { name: 'Fliesen spät, 2026-03-17' }))).toBe(true)
    const day = screen.getByRole('button', { name: 'Abriss früh, 2026-03-17' })
    expect(fireEvent.dragOver(day)).toBe(false)
    fireEvent.drop(day)
    fireEvent.dragEnd(box)
    await waitFor(() => expect(batch()).not.toBeNull())
    expect(batch()).toEqual([
      { employeeId: 2, date: '2026-03-17', entries: [expect.objectContaining({ siteId: 10, activity: 'Abriss' })] },
    ])
    // Still the week it was planned in.
    expect(screen.getByText('KW 12 · ab 16.03.')).toBeInTheDocument()
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

  it('follows the activity filter: only sites and open tasks with those activities', async () => {
    renderWithProviders(<EmployeeMiniPlan employeeId={2} canEdit activityFilter={new Set(['Abriss'])} />)
    await screen.findByText('KW 10 · ab 02.03.')
    // Meier only has Fliesen, the Fliesen tasks drop out.
    expect(laneNames()).toEqual(['Abriss früh'])
  })
})
