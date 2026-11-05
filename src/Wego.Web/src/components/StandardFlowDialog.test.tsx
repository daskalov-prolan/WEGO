import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayEntryInput, Entry, Plan, Site } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { StandardFlowDialog } from './StandardFlowDialog'

const site: Site = {
  id: 20, name: 'Familie Kern', client: 'Familie Kern', street: null, houseNumber: null, addressAddition: null, postalCode: null,
  city: null, nameSource: 'Auftraggeber', description: null, plannedStart: '2026-03-06', plannedEnd: null, status: 'Angebot',
  tasks: [], labelProjectNumber: null, clientPhone: null,
}

const person = (id: number, name: string) => ({ id, name, mainActivity: null, additionalActivities: [] })

const entry = (id: number, employeeId: number, date: string, siteId: number | null, activity: string | null, type: Entry['type'] = 'Baustelle'): Entry => ({
  id, employeeId, employeeName: '', date, type, siteId, siteName: siteId === 20 ? 'Familie Kern' : siteId ? 'Familie Meier' : null,
  activity, startTime: null, endTime: null, note: null, noteImportant: false,
})

const plan: Plan = {
  year: 2026,
  employees: [
    person(1, 'Stefan Buder'),
    person(2, 'Sascha Herrmann'),
    person(3, 'Niko - Nikolay Mihov'),
    person(4, 'Neycho Boyadzhiev'),
    person(5, 'Patrick Kletta'),
    person(6, 'Nikolay Prodanov (Koko)'),
  ],
  sites: [site],
  // Tuesday 10 March as a holiday, to see it skipped.
  schoolHolidays: [{ id: 1, name: 'Testfeiertag', kind: 'Feiertag', startDate: '2026-03-10', endDate: '2026-03-10' }],
  entries: [
    // A reserved day of the site (no activity): the flow takes its place.
    entry(1, 2, '2026-03-04', 20, null),
    // Patrick has vacation on day 6: left out.
    entry(2, 5, '2026-03-16', null, null, 'Urlaub'),
  ],
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => new Response(url === '/api/plan/batch' ? '[]' : JSON.stringify(plan), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('StandardFlowDialog', () => {
  it('enters the standard flow on working days, replaces the reserved days and can be taken back', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<StandardFlowDialog site={site} onClose={onClose} />)

    // Day 1 is Friday 6 March; the weekend and the holiday on 10 March are left out: day 3 is Wednesday 11 March.
    expect(await screen.findByText('Fr 06.03.')).toBeInTheDocument()
    expect(screen.getByText('Mo 09.03.')).toBeInTheDocument()
    expect(screen.queryByText('Di 10.03.')).not.toBeInTheDocument()
    expect(screen.getByText('Mi 11.03.')).toBeInTheDocument()
    // Niko is found by the name he is called by; Patrick's vacation shows.
    expect(screen.getAllByText(/Niko - Nikolay Mihov · Abriss/).length).toBe(1)
    expect(screen.getByText(/Urlaub: wird ausgelassen/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Standardablauf eintragen' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())

    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    const days = JSON.parse(String(call[1].body)) as { employeeId: number; date: string; entries: DayEntryInput[] }[]
    const of = (employeeId: number, date: string) => days.find((day) => day.employeeId === employeeId && day.date === date)?.entries
    // The reserved day is emptied.
    expect(of(2, '2026-03-04')).toEqual([])
    // Day 1: Stefan Sanitär in the morning, Sascha and Niko Abriss the whole day.
    expect(of(1, '2026-03-06')).toEqual([expect.objectContaining({ siteId: 20, activity: 'Sanitaer', startTime: '07:30:00', endTime: '11:30:00' })])
    expect(of(3, '2026-03-06')).toEqual([expect.objectContaining({ activity: 'Abriss', startTime: null })])
    // Day 5 (Friday 13 March): the last of the Trockenbau; the tiles begin on day 6.
    expect(of(2, '2026-03-13')).toEqual([expect.objectContaining({ activity: 'Trockenbau', startTime: null })])
    expect(of(5, '2026-03-13')).toBeUndefined()
    expect(of(5, '2026-03-17')).toEqual([expect.objectContaining({ activity: 'Fliesen' })])
    // Patrick's vacation (day 6, Monday 16 March) stays untouched; day 11 is Monday 23 March.
    expect(of(5, '2026-03-16')).toBeUndefined()
    expect(of(4, '2026-03-23')).toEqual([expect.objectContaining({ activity: 'Sanitaer' })])
    expect(of(6, '2026-03-06')).toBeUndefined()

    // Handed over to the plan: its undo arrow takes the whole flow back.
    const step = JSON.parse(sessionStorage.getItem('wego.plan.undo')!)
    expect(step.after).toHaveLength(days.length)
    expect(step.before.find((day: { date: string }) => day.date === '2026-03-04').entries).toHaveLength(1)
  })
})
