import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, Plan } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { PlanPage } from './PlanPage'

const noAddress = { client: null, street: null, houseNumber: null, addressAddition: null, postalCode: null, city: null, nameSource: 'Auftraggeber' as const, description: null, plannedStart: null, plannedEnd: null, status: 'Bauphase' as const }

const plan: Plan = {
  year: 2026,
  employees: [
    { id: 1, name: 'Anna', mainActivity: null, additionalActivities: [] },
    { id: 2, name: 'Bernd', mainActivity: 'Sanitaer', additionalActivities: ['Abriss'] },
  ],
  sites: [
    { id: 10, name: 'Familie Schulze', ...noAddress },
    { id: 11, name: 'Familie Meier', ...noAddress },
    { id: 12, name: 'Familie Werner', ...noAddress },
    { id: 13, name: 'Altbau', ...noAddress, status: 'Abgeschlossen' as const },
  ],
  schoolHolidays: [
    { id: 5, name: 'Winterferien', kind: 'Schulferien', startDate: '2026-02-02', endDate: '2026-02-07' },
    { id: 6, name: 'Frauentag', kind: 'Feiertag', startDate: '2026-03-08', endDate: '2026-03-08' },
  ],
  entries: [
    entry(1, 1, '2026-03-02', 10, 'Familie Schulze', '08:00:00', '10:00:00'),
    entry(2, 1, '2026-03-02', 11, 'Familie Meier', '11:00:00', '13:00:00'),
    entry(3, 2, '2026-03-03', 11, 'Familie Meier', null, null),
    { ...entry(4, 2, '2026-03-12', 10, 'Familie Schulze', null, null), note: 'mit 2 Helfern' },
    { ...entry(5, 2, '2026-03-13', 11, 'Familie Meier', null, null), note: 'Wasser abstellen!', noteImportant: true },
    entry(6, 2, '2026-02-20', 12, 'Familie Werner', null, null),
    entry(7, 1, '2026-03-04', 13, 'Altbau', null, null),
  ],
}

function entry(id: number, employeeId: number, date: string, siteId: number, siteName: string, start: string | null, end: string | null): Entry {
  return {
    id, employeeId, employeeName: employeeId === 1 ? 'Anna' : 'Bernd', date, type: 'Baustelle', siteId, siteName, activity: null,
    startTime: start, endTime: end, note: null, noteImportant: false,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-02T09:00:00') })
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/plan/batch') {
      const days = JSON.parse(String(init?.body)) as { employeeId: number; date: string; entries: { type: string; activity: string | null }[] }[]
      const saved = days.flatMap((day, index) =>
        day.entries.map((e) => ({ ...entry(100 + index, day.employeeId, day.date, 0, '', null, null), type: e.type, activity: e.activity, siteId: null, siteName: null })),
      )
      return new Response(JSON.stringify(saved), { status: 200 })
    }
    return new Response(JSON.stringify(plan), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const cell = (label: RegExp) => screen.getByRole('button', { name: label })

describe('PlanPage', () => {
  it('starts with the current week: employees in rows, days from left to right, a split day with its time windows', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)

    expect(await screen.findByText('KW 10–11 · 02.03.–15.03.2026')).toBeInTheDocument()
    const monday = cell(/Anna, Montag, 02.03.2026/)
    expect(within(monday).getByText('8–10 Uhr')).toBeInTheDocument()
    expect(within(monday).getByText('11–13 Uhr')).toBeInTheDocument()
    // The short form for narrow screens names the first site and counts the rest.
    expect(within(monday).getByText('+1')).toBeInTheDocument()

    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Anna', 'Bernd'])
    expect(document.getElementById('col-2026-03-02')).toHaveTextContent('Mo02.03.')
  })

  it('moves by week and by month', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    expect(screen.getByText('KW 11–12 · 09.03.–22.03.2026')).toBeInTheDocument()
    expect(within(cell(/Bernd, Donnerstag, 12.03.2026/)).getAllByText('Familie Schulze')).not.toHaveLength(0)

    await userEvent.click(screen.getByRole('radio', { name: 'Monat' }))
    expect(screen.getAllByText('März 2026').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(screen.getAllByText('Februar 2026').length).toBeGreaterThan(0)
    expect(document.getElementById('col-2026-02-03')).toHaveAttribute('title', expect.stringContaining('Winterferien'))
  })

  it('folds weekends to narrow strips unless switched off', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)
    const table = () => document.querySelector('table.timeline')!

    expect(table()).toHaveClass('fold-weekends')
    await userEvent.click(screen.getByRole('switch', { name: 'Wochenenden ausblenden' }))
    expect(table()).not.toHaveClass('fold-weekends')
    expect(localStorage.getItem('wego.plan.showWeekends')).toBe('true')
  })

  it('selects and deselects all employees at once', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await user.click(screen.getByRole('button', { name: 'Mitarbeiter (2/2)' }))
    await user.click(await screen.findByRole('button', { name: 'Alle abwählen', hidden: true }))
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Mitarbeiter (0/2)', hidden: true })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Alle auswählen', hidden: true }))
    expect(screen.getAllByRole('rowheader')).toHaveLength(2)
  })

  it('opens the record of a site from its name in a cell', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)

    const monday = cell(/Anna, Montag, 02.03.2026/)
    await user.click(within(monday).getAllByRole('link', { name: 'Familie Meier' })[0])

    expect(await screen.findByText('Auftraggeber')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument()
    // The day editor did not open.
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()
  })

  it('shows the sites in the rows and the employees in the cells', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)

    await user.click(screen.getByRole('radio', { name: 'Nach Baustelle' }))

    // Rows in the order the work starts: Schulze and Meier on 2 March.
    // Done sites are left out by default; Werner had work before today, so the hint shows up.
    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual([
      'Familie Werner',
      'Familie Meier',
      'Familie Schulze',
    ])
    expect(screen.getByRole('button', { name: /Frühere Einsätze: 1 offene Baustellen/ })).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Nur unerledigte Baustellen' }))
    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toContain('Altbau')
    await user.click(screen.getByRole('switch', { name: 'Nur unerledigte Baustellen' }))
    const meierMonday = screen.getByRole('button', { name: /Familie Meier, Montag, 02.03.2026/ })
    expect(within(meierMonday).getAllByText('Anna').length).toBeGreaterThan(0)
    const meierTuesday = screen.getByRole('button', { name: /Familie Meier, Dienstag, 03.03.2026/ })
    expect(within(meierTuesday).getAllByText('Bernd').length).toBeGreaterThan(0)
    expect(localStorage.getItem('wego.plan.perspective')).toBe('sites')

    // A day of a site: who is there, and planning somebody else.
    await user.click(meierTuesday)
    expect(await screen.findByText('Weitere Mitarbeiter einplanen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeInTheDocument()
  })
  it('opens the record of the chosen site from the day editor and comes back to it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await user.click(await screen.findByRole('button', { name: /Bernd, Dienstag, 03.03.2026/ }))

    await user.click(await screen.findByText('Datensatz öffnen: Familie Meier'))
    expect(await screen.findByText('Auftraggeber')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Schließen' }))
    expect(screen.queryByText('Auftraggeber')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
  })

  it('marks a cell with a note', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    const withNote = cell(/Bernd, Donnerstag, 12.03.2026/)
    // The sign sits inside the coloured entry.
    const sign = within(withNote).getAllByRole('img', { name: 'mit Notiz' })[0]
    expect(sign.closest('.chip, .cell-compact')).not.toBeNull()
    expect(withNote).toHaveAttribute('title', expect.stringContaining('Notiz: mit 2 Helfern'))
    expect(within(cell(/Anna, Montag, 02.03.2026/)).queryByRole('img', { name: 'mit Notiz' })).not.toBeInTheDocument()

    const important = cell(/Bernd, Freitag, 13.03.2026/)
    expect(within(important).getAllByRole('img', { name: 'wichtige Notiz' })[0]).toHaveTextContent('!')
    expect(important).toHaveAttribute('title', expect.stringContaining('WICHTIG: Wasser abstellen!'))
  })

  it('dims everything but the filtered site', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await userEvent.type(screen.getByLabelText('Baustellen-Filter'), 'schulze')

    const monday = cell(/Anna, Montag, 02.03.2026/)
    expect(within(monday).getAllByText('Familie Schulze')[0].closest('.chip')).not.toHaveClass('dimmed')
    expect(within(monday).getByText('Familie Meier').closest('.chip')).toHaveClass('dimmed')
    expect(screen.getByText(/2 Tage mit Einsätzen in 2026/)).toBeInTheDocument()
  })

  it('zooms out to the whole year and marks holidays', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await userEvent.click(screen.getByRole('radio', { name: 'Jahr' }))

    expect(document.querySelector('table.timeline')).toHaveClass('zoom-year')
    expect(cell(/Anna, Montag, 02.03.2026/)).toHaveAttribute('title', 'Familie Schulze / Familie Meier')
    expect(document.getElementById('col-2026-03-08')).toHaveClass('public-holiday')
    expect(document.getElementById('col-2026-02-03')).toHaveClass('holiday')
  })

  it('opens a read-only day for employees and the editor for planners', async () => {
    const { unmount } = renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await userEvent.click(await screen.findByRole('button', { name: /Anna, Montag, 02.03.2026/ }))
    expect(await screen.findByRole('button', { name: 'Schließen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()
    unmount()

    renderWithProviders(<PlanPage year={2026} canEdit />)
    await userEvent.click(await screen.findByRole('button', { name: /Anna, Montag, 02.03.2026/ }))
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeInTheDocument()
  })

  it('starts a site entry with the main activity and offers only the activities of the employee', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await user.click(await screen.findByRole('button', { name: /Bernd, Mittwoch, 04.03.2026/ }))

    const input = (label: RegExp) => screen.getAllByLabelText(label).find((element) => element.tagName === 'INPUT')!
    await screen.findAllByLabelText(/^Baustelle/)
    await user.click(input(/^Baustelle/))
    await user.click(await screen.findByRole('option', { name: /Familie Schulze/, hidden: true }))
    expect(input(/^Tätigkeit/)).toHaveValue('Sanitär (Haupttätigkeit)')
    await user.click(input(/^Tätigkeit/))
    // The site options of the field above are options too.
    const options = (await screen.findAllByRole('option', { hidden: true }))
      .map((option) => option.textContent)
      .filter((text) => !text?.includes('Familie'))
    expect(options).toEqual(['Sanitär (Haupttätigkeit)', 'Abriss / Baubeginn'])
    await user.click(await screen.findByRole('option', { name: 'Abriss / Baubeginn', hidden: true }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))[0].entries).toEqual([
      expect.objectContaining({ type: 'Baustelle', siteId: 10, activity: 'Abriss' }),
    ])
  })
  it('lets planners select several cells and fill them in one go', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)

    await user.keyboard('{Control>}')
    await user.click(cell(/Bernd, Mittwoch, 04.03.2026/))
    await user.click(cell(/Bernd, Donnerstag, 05.03.2026/))
    await user.keyboard('{/Control}')

    expect(screen.getByText('2 Felder ausgewählt')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Urlaub' }))

    await waitFor(() => expect(within(cell(/Bernd, Mittwoch, 04.03.2026/)).getAllByText('Urlaub')).not.toHaveLength(0))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))).toEqual([
      expect.objectContaining({ employeeId: 2, date: '2026-03-04', entries: [expect.objectContaining({ type: 'Urlaub' })] }),
      expect.objectContaining({ employeeId: 2, date: '2026-03-05', entries: [expect.objectContaining({ type: 'Urlaub' })] }),
    ])
    expect(await screen.findByRole('button', { name: 'Rückgängig' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByText('2 Felder ausgewählt')).not.toBeInTheDocument()
  })
})
