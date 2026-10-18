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

describe('EmployeeMiniPlan', () => {
  it('lists the open tasks of the main activity first, then of the additional ones, each by planned start', async () => {
    renderWithProviders(<EmployeeMiniPlan employeeId={2} canEdit />)
    const group = await screen.findByRole('group', { name: 'Ungeplante Tätigkeiten' })
    const boxes = within(group).getAllByRole('button').filter((button) => button.classList.contains('task-box'))
    // Sanitär at "Fliesen früh" is nothing Bernd does.
    expect(boxes.map((button) => button.textContent)).toEqual(['Fliesen früh', 'Fliesen spät', 'Abriss früh'])
    expect(within(group).getByText('auch:')).toBeInTheDocument()
  })

  it('opens at the current week, jumps to the next free week and plans a dragged task on a day', async () => {
    const user = userEvent.setup()
    renderWithProviders(<EmployeeMiniPlan employeeId={2} canEdit />)
    expect(await screen.findByText('KW 10 · ab 02.03.')).toBeInTheDocument()
    expect(screen.getByText('KW 10 · 20 %')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Bernd, 2026-03-03' })).getAllByText('Meier').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /Nächste freie Woche/ }))
    expect(screen.getByText('KW 12 · ab 16.03.')).toBeInTheDocument()

    const box = within(screen.getByRole('group', { name: 'Ungeplante Tätigkeiten' })).getByRole('button', { name: 'Abriss früh' })
    const day = screen.getByRole('button', { name: 'Bernd, 2026-03-17' })
    fireEvent.dragStart(box)
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

  it('moves an entry to another day by dragging it', async () => {
    renderWithProviders(<EmployeeMiniPlan employeeId={2} canEdit />)
    const tuesday = await screen.findByRole('button', { name: 'Bernd, 2026-03-03' })
    const chip = within(tuesday).getAllByText('Meier')[0].closest('.chip')!
    expect(fireEvent.dragOver(tuesday)).toBe(true)
    fireEvent.dragStart(chip)
    expect(fireEvent.dragOver(tuesday)).toBe(true)
    const thursday = screen.getByRole('button', { name: 'Bernd, 2026-03-05' })
    expect(fireEvent.dragOver(thursday)).toBe(false)
    fireEvent.drop(thursday)
    fireEvent.dragEnd(chip)
    await waitFor(() => expect(batch()).not.toBeNull())
    expect(batch()).toEqual([
      { employeeId: 2, date: '2026-03-03', entries: [] },
      { employeeId: 2, date: '2026-03-05', entries: [expect.objectContaining({ siteId: 13 })] },
    ])
  })
})
