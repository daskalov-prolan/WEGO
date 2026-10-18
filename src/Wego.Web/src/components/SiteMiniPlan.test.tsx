import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, Plan, Site } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { SiteMiniPlan } from './SiteMiniPlan'

const site: Site = {
  id: 10, name: 'Familie Schulze', client: 'Familie Schulze', labelProjectNumber: null, street: null, houseNumber: null,
  addressAddition: null, postalCode: null, city: null, nameSource: 'Auftraggeber', description: null,
  // Planned for April, but the first work is planned for early March already.
  plannedStart: '2026-04-01', plannedEnd: null, status: 'Bauphase',
  tasks: [
    { activity: 'Abriss', estimatedDays: 1, notNeeded: false },
    { activity: 'Fliesen', estimatedDays: 1, notNeeded: false },
  ],
}

function entry(id: number, employeeId: number, employeeName: string, date: string, siteId: number, siteName: string, activity: Entry['activity']): Entry {
  return {
    id, employeeId, employeeName, date, type: 'Baustelle', siteId, siteName, activity,
    startTime: null, endTime: null, note: null, noteImportant: false,
  }
}

const plan: Plan = {
  year: 2026,
  employees: [
    { id: 1, name: 'Anna', mainActivity: 'Abriss', additionalActivities: [] },
    { id: 2, name: 'Bernd', mainActivity: 'Fliesen', additionalActivities: [] },
  ],
  sites: [site],
  schoolHolidays: [],
  entries: [
    entry(1, 1, 'Anna', '2026-03-05', 10, 'Familie Schulze', 'Abriss'),
    entry(2, 2, 'Bernd', '2026-03-05', 11, 'Familie Meier', 'Fliesen'),
  ],
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

describe('SiteMiniPlan', () => {
  it('opens at the first planned work, without any at the planned start', async () => {
    // The first entry at this site (Abriss on 5 March), not the planned start in April.
    const { unmount } = renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText('KW 10 · ab 02.03.')).toBeInTheDocument()
    unmount()

    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...plan, entries: [] }), { status: 200 }))
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText('KW 14 · ab 30.03.')).toBeInTheDocument()
  })

  it('shows the course of the site: open activities of its status to drag, planned ones greyed', async () => {
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText('KW 10 · ab 02.03.')).toBeInTheDocument()
    const flow = screen.getByRole('group', { name: 'Ablauf der Baustelle' })

    // Only the current status is opened up: the activities of the Bauphase, none of the Angebot.
    expect(within(flow).queryByText('Besichtigung')).not.toBeInTheDocument()
    // Fliesen is still open: a box that can be dragged. Abriss is planned: greyed, nothing to drag.
    const fliesen = within(flow).getByRole('button', { name: 'Fliesenarbeiten' })
    expect(fliesen).toHaveAttribute('draggable', 'true')
    const abriss = within(flow).getByText(/Abriss \/ Baubeginn/).closest('.flow-step')!
    expect(abriss).toHaveClass('planned')
    expect(abriss).not.toHaveAttribute('draggable')
    // No filter any more: nothing in the flow switches the calendar.
    expect(within(flow).queryAllByRole('button', { pressed: true })).toHaveLength(0)
  })

  it('moves by week and jumps to the next week in which someone who can do open work is free', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText('KW 10 · ab 02.03.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Woche vor' }))
    expect(screen.getByText('KW 11 · ab 09.03.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Baubeginn' }))
    expect(screen.getByText('KW 14 · ab 30.03.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Heute' }))
    expect(screen.getByText('KW 10 · ab 02.03.')).toBeInTheDocument()

    // Bernd is free in KW 10 too, but the jump looks for the next week after the first one shown.
    await user.click(screen.getByRole('button', { name: /Nächste freie Woche/ }))
    expect(screen.getByText('KW 11 · ab 09.03.')).toBeInTheDocument()
  })

  it('counts additional activities for the free week, and any entry makes the week taken', async () => {
    const user = userEvent.setup()
    const busier: Plan = {
      ...plan,
      employees: [
        ...plan.employees,
        // Carla lays tiles as well (additional activity); Dora does not.
        { id: 3, name: 'Carla', mainActivity: 'Sanitaer', additionalActivities: ['Fliesen'] },
        { id: 4, name: 'Dora', mainActivity: 'Sanitaer', additionalActivities: [] },
      ],
      entries: [
        ...plan.entries,
        entry(3, 2, 'Bernd', '2026-03-09', 11, 'Familie Meier', 'Fliesen'),
        entry(4, 2, 'Bernd', '2026-03-16', 11, 'Familie Meier', 'Fliesen'),
        entry(5, 3, 'Carla', '2026-03-10', 11, 'Familie Meier', 'Sanitaer'),
      ],
    }
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/plan/batch' ? new Response('[]', { status: 200 }) : new Response(JSON.stringify(busier), { status: 200 }),
    )
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText('KW 10 · ab 02.03.')).toBeInTheDocument()

    // KW 11: Bernd and Carla have an entry, Dora is free but cannot lay tiles. KW 12: Carla is free.
    await user.click(screen.getByRole('button', { name: /Nächste freie Woche/ }))
    expect(screen.getByText('KW 12 · ab 16.03.')).toBeInTheDocument()
    // The lanes stay with the main activity: Bernd only.
    expect(screen.getByRole('button', { name: 'Bernd, 2026-03-16' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Carla, 2026-03-16' })).not.toBeInTheDocument()
  })

  it('shows a lane per employee with an open main activity, the weekly load and the open activities', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)

    // The first entry is on Thursday 5 March: the weeks begin on Monday 2 March.
    // Bernd (main activity Fliesen, still open) works one of five days in KW 10, none in KW 11.
    expect(await screen.findByText('KW 10 · 20 %')).toBeInTheDocument()
    expect(screen.getByText('KW 11 · 0 %')).toBeInTheDocument()

    // One lane per employee whose main activity is still open here: Bernd (Fliesen), not Anna (Abriss is planned).
    expect(screen.queryByRole('button', { name: 'Anna, 2026-03-05' })).not.toBeInTheDocument()
    const thursday = screen.getByRole('button', { name: 'Bernd, 2026-03-05' })
    expect(within(thursday).getAllByText('Familie Meier').length).toBeGreaterThan(0)

    // Abriss is planned already, Fliesen is still open.
    const open = screen.getAllByRole('button').filter((button) => button.classList.contains('task-box'))
    expect(open.map((button) => button.textContent)).toEqual(['Fliesenarbeiten'])

    // Planning it: only who can do it is offered (Bernd lays tiles, Anna does not).
    await user.click(open[0])
    expect(await screen.findByText('Fliesenarbeiten einplanen')).toBeInTheDocument()
    const picker = screen.getAllByLabelText(/^Mitarbeiter/).find((element) => element.tagName === 'INPUT')!
    await user.click(picker)
    const options = (await screen.findAllByRole('option', { hidden: true })).map((option) => option.textContent)
    expect(options).toEqual(['Bernd'])
    await user.click(screen.getByRole('option', { name: 'Bernd', hidden: true }))
    await user.click(screen.getByRole('button', { name: 'Einplanen', hidden: true }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))).toEqual([
      expect.objectContaining({
        employeeId: 2,
        date: '2026-03-02',
        entries: expect.arrayContaining([expect.objectContaining({ siteId: 10, activity: 'Fliesen' })]),
      }),
    ])
  })

  it('plans an open activity and moves entries by dragging them onto a day of a lane', async () => {
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText('KW 10 · ab 02.03.')).toBeInTheDocument()
    const batch = () => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')
      return call ? JSON.parse(String(call[1].body)) : null
    }
    const dropOn = (source: Element, target: Element) => {
      fireEvent.dragStart(source)
      const taken = !fireEvent.dragOver(target)
      fireEvent.drop(target)
      fireEvent.dragEnd(source)
      return taken
    }

    const box = screen.getAllByRole('button').find((button) => button.classList.contains('task-box'))!
    expect(dropOn(box, screen.getByRole('button', { name: 'Bernd, 2026-03-04' }))).toBe(true)
    await waitFor(() => expect(batch()).not.toBeNull())
    expect(batch()).toEqual([
      expect.objectContaining({
        employeeId: 2,
        date: '2026-03-04',
        entries: [expect.objectContaining({ siteId: 10, activity: 'Fliesen' })],
      }),
    ])
    fetchMock.mockClear()

    // Bernd's day elsewhere moves to Friday; his own cell does not take it.
    const chip = within(screen.getByRole('button', { name: 'Bernd, 2026-03-05' })).getAllByText('Familie Meier')[0].closest('.chip')!
    expect(dropOn(chip, screen.getByRole('button', { name: 'Bernd, 2026-03-05' }))).toBe(false)
    expect(dropOn(chip, screen.getByRole('button', { name: 'Bernd, 2026-03-06' }))).toBe(true)
    await waitFor(() => expect(batch()).not.toBeNull())
    expect(batch()).toEqual([
      { employeeId: 2, date: '2026-03-05', entries: [] },
      expect.objectContaining({ employeeId: 2, date: '2026-03-06', entries: [expect.objectContaining({ siteId: 11 })] }),
    ])
  })

  it('cancels an open activity: it is then only listed as cancelled here, and can be brought back', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/sites/10/tasks/')) {
        const { notNeeded } = JSON.parse(String(init?.body)) as { notNeeded: boolean }
        const activity = url.split('/').pop()
        return new Response(
          JSON.stringify({ ...site, tasks: site.tasks.map((task) => (task.activity === activity ? { ...task, notNeeded } : task)) }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify(plan), { status: 200 })
    })
    // The site page keeps the site; the plan reports the saved one back to it.
    function Page() {
      const [shown, setShown] = useState(site)
      return <SiteMiniPlan site={shown} canEdit onSiteChange={setShown} />
    }
    renderWithProviders(<Page />)
    expect(await screen.findByText('KW 10 · ab 02.03.')).toBeInTheDocument()

    const taskBoxes = () => screen.queryAllByRole('button').filter((button) => button.classList.contains('task-box'))
    await user.click(taskBoxes()[0])
    await user.click(await screen.findByRole('button', { name: 'Stornieren', hidden: true }))
    await waitFor(() => expect(taskBoxes()).toHaveLength(0))
    const cancelled = screen.getByText('Fliesenarbeiten').closest('.flow-step')! as HTMLElement
    expect(cancelled).toHaveClass('cancelled')
    const put = fetchMock.mock.calls.find(([url]) => url === '/api/sites/10/tasks/Fliesen')!
    expect(JSON.parse(String(put[1].body))).toEqual({ estimatedDays: 1, notNeeded: true })

    await user.click(within(cancelled).getByRole('button', { name: 'Wiederherstellen' }))
    await waitFor(() => expect(taskBoxes().map((button) => button.textContent)).toEqual(['Fliesenarbeiten']))
    expect(document.querySelector('.flow-step.cancelled')).toBeNull()
  })

  it('stays in the week in view after planning', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SiteMiniPlan site={site} canEdit />)
    expect(await screen.findByText('KW 10 · ab 02.03.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Woche vor' }))
    await user.click(screen.getByRole('button', { name: 'Woche vor' }))
    expect(screen.getByText('KW 12 · ab 16.03.')).toBeInTheDocument()

    const box = screen.getAllByRole('button').find((button) => button.classList.contains('task-box'))!
    fireEvent.dragStart(box)
    fireEvent.dragOver(screen.getByRole('button', { name: 'Bernd, 2026-03-17' }))
    fireEvent.drop(screen.getByRole('button', { name: 'Bernd, 2026-03-17' }))
    fireEvent.dragEnd(box)
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url !== '/api/plan/batch').length).toBeGreaterThan(1))
    // Planned and loaded again: still KW 12; the next free week is the planner's own step.
    expect(screen.getByText('KW 12 · ab 16.03.')).toBeInTheDocument()
  })
})
