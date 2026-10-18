import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, Plan } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { PlanPage } from './PlanPage'

const noAddress = { client: null, street: null, houseNumber: null, addressAddition: null, postalCode: null, city: null, nameSource: 'Auftraggeber' as const, description: null, plannedStart: null, plannedEnd: null, status: 'Bauphase' as const, tasks: [], labelProjectNumber: null }

const plan: Plan = {
  year: 2026,
  employees: [
    { id: 1, name: 'Anna', mainActivity: 'Abriss', additionalActivities: [] },
    { id: 2, name: 'Bernd', mainActivity: 'Sanitaer', additionalActivities: ['Abriss'] },
  ],
  sites: [
    { id: 10, name: 'Familie Schulze', ...noAddress },
    { id: 11, name: 'Familie Meier', ...noAddress },
    {
      id: 12,
      name: 'Familie Werner',
      ...noAddress,
      // Fliesen is planned once (2 expected), Abriss not at all, RenoDeco is not needed.
      tasks: [
        { activity: 'Abriss' as const, estimatedDays: 1, notNeeded: false },
        { activity: 'RenoDeco' as const, estimatedDays: 1, notNeeded: true },
        { activity: 'Fliesen' as const, estimatedDays: 2, notNeeded: false },
      ],
    },
    { id: 13, name: 'Altbau', ...noAddress, status: 'Abgeschlossen' as const },
  ],
  schoolHolidays: [
    { id: 5, name: 'Winterferien', kind: 'Schulferien', startDate: '2026-02-02', endDate: '2026-02-07' },
    { id: 6, name: 'Frauentag', kind: 'Feiertag', startDate: '2026-03-08', endDate: '2026-03-08' },
  ],
  entries: [
    { ...entry(1, 1, '2026-03-02', 10, 'Familie Schulze', '08:00:00', '10:00:00'), activity: 'Fliesen' },
    { ...entry(2, 1, '2026-03-02', 11, 'Familie Meier', '11:00:00', '13:00:00'), activity: 'Trockenbau' },
    entry(3, 2, '2026-03-03', 11, 'Familie Meier', null, null),
    { ...entry(4, 2, '2026-03-12', 10, 'Familie Schulze', null, null), note: 'mit 2 Helfern' },
    { ...entry(5, 2, '2026-03-13', 11, 'Familie Meier', null, null), note: 'Wasser abstellen!', noteImportant: true },
    { ...entry(6, 2, '2026-02-20', 12, 'Familie Werner', null, null), activity: 'Fliesen' },
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

  it('opens the page of a site from its name in a cell, and comes back to the same week', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/plan'
    const { unmount } = renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    await screen.findByText(/KW 11/)

    const monday = cell(/Anna, Montag, 02.03.2026/)
    await user.click(within(monday).getAllByRole('link', { name: 'Familie Meier' })[0])

    // Straight to the page of the site: no record in between, and the day editor did not open.
    expect(window.location.hash).toBe('#/baustellen/11')
    expect(screen.queryByText('Auftraggeber')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()

    // Back in the plan: the week it was left at, once.
    unmount()
    const again = renderWithProviders(<PlanPage year={2026} canEdit />)
    expect(await screen.findByText(/KW 11/)).toBeInTheDocument()
    again.unmount()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    expect(await screen.findByText(/KW 10/)).toBeInTheDocument()
  })

  it('shows employees the record of a site, since they have no site pages', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    const monday = cell(/Anna, Montag, 02.03.2026/)
    await user.click(within(monday).getAllByRole('link', { name: 'Familie Meier' })[0])
    expect(await screen.findByText('Auftraggeber')).toBeInTheDocument()
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

  it('filters by one or more activities from the legend', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)
    const chipOf = (name: string) => within(cell(/Anna, Montag, 02.03.2026/)).getAllByText(name)[0].closest('.chip')

    await user.click(screen.getByRole('button', { name: 'Fliesenarbeiten' }))
    expect(chipOf('Familie Schulze')).not.toHaveClass('dimmed')
    expect(chipOf('Familie Meier')).toHaveClass('dimmed')

    // A second activity is added to the filter.
    await user.click(screen.getByRole('button', { name: 'Trockenbau' }))
    expect(chipOf('Familie Meier')).not.toHaveClass('dimmed')

    // By site only the sites with such work remain.
    await user.click(screen.getByRole('button', { name: 'Trockenbau' }))
    await user.click(screen.getByRole('radio', { name: 'Nach Baustelle' }))
    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Familie Werner', 'Familie Schulze'])

    await user.click(screen.getByRole('button', { name: /Alle anzeigen/ }))
    expect(screen.getAllByRole('rowheader').length).toBeGreaterThan(1)
    expect(screen.queryByRole('button', { name: /Alle anzeigen/ })).not.toBeInTheDocument()

    // The name of a status switches all of its activities.
    await user.click(screen.getByRole('button', { name: 'Bauphase' }))
    expect(screen.getByRole('button', { name: 'Endmontage' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Besichtigung' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('lists the activities a site still needs and marks entries with the sign of their activity', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)

    // The sign of the activity starts the entry.
    const monday = cell(/Anna, Montag, 02.03.2026/)
    expect(monday.querySelector('.chip [data-activity="Fliesen"]')).not.toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Nach Baustelle' }))
    const werner = screen
      .getAllByRole('row')
      .find((row) => row.textContent?.startsWith('Familie Werner'))!
      .querySelector<HTMLElement>('.tasks')!
    const boxes = within(werner).getAllByRole('button').map((box) => box.textContent)
    expect(boxes).toEqual(['Abriss / Baubeginn', 'Fliesenarbeiten'])

    // Filtered by an activity, a site that still needs it stays even without any entry of it.
    // (the legend: the open task boxes carry the same name)
    await user.click(within(screen.getByRole('group', { name: /Ablauf/ })).getByRole('button', { name: 'Abriss / Baubeginn' }))
    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Familie Werner'])
  })
  it('offers each employee the open tasks of their main activity and plans one on a chosen day', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)

    const annaRow = screen.getAllByRole('row').find((row) => row.textContent?.startsWith('Anna'))!
    const box = within(annaRow.querySelector<HTMLElement>('.tasks')!).getByRole('button', { name: /Familie Werner/ })
    await user.click(box)
    expect(await screen.findByText('Abriss / Baubeginn einplanen')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Einplanen', hidden: true }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))).toEqual([
      expect.objectContaining({
        employeeId: 1,
        date: '2026-03-02',
        entries: expect.arrayContaining([expect.objectContaining({ siteId: 12, activity: 'Abriss' })]),
      }),
    ])
  })

  it('lists the open tasks of the main activity first, then of the additional ones, each by planned start', async () => {
    const site = (id: number, name: string, plannedStart: string | null, activity: 'Abriss' | 'Sanitaer') => ({
      id, name, ...noAddress, plannedStart,
      tasks: [{ activity, estimatedDays: 1, notNeeded: false }],
    })
    const sorted: Plan = {
      ...plan,
      sites: [
        site(20, 'Abriss Mai', '2026-05-01', 'Abriss'),
        site(21, 'Abriss April', '2026-04-01', 'Abriss'),
        site(22, 'Sanitär Juni', '2026-06-01', 'Sanitaer'),
        site(23, 'Sanitär ohne Datum', null, 'Sanitaer'),
      ],
      entries: [],
    }
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(sorted), { status: 200 }))
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)

    // Bernd: Sanitär is his main activity, Abriss an additional one.
    const tasks = screen.getAllByRole('row').find((row) => row.textContent?.startsWith('Bernd'))!.querySelector<HTMLElement>('.tasks')!
    await user.click(within(tasks).getByRole('button', { name: /weitere/ }))
    expect(within(tasks).getAllByRole('button').filter((button) => button.classList.contains('task-box')).map((button) => button.textContent)).toEqual([
      'Sanitär Juni',
      'Sanitär ohne Datum',
      'Abriss April',
      'Abriss Mai',
    ])
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
    expect(cell(/Anna, Montag, 02.03.2026/)).toHaveAttribute('title', 'Familie Schulze – Fliesenarbeiten / Familie Meier – Trockenbau')
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
  it('offers only the activities of the selected employees when filling several cells with a site', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)

    await user.keyboard('{Control>}')
    await user.click(cell(/Anna, Mittwoch, 04.03.2026/))
    await user.click(cell(/Anna, Donnerstag, 05.03.2026/))
    await user.keyboard('{/Control}')
    await user.click(screen.getByRole('button', { name: 'Baustelle …' }))

    // Anna does Abriss only.
    await screen.findByText('Baustelle für 2 Felder')
    const input = screen.getAllByLabelText('Tätigkeit').find((element) => element.tagName === 'INPUT')!
    await user.click(input)
    const list = await waitFor(() => document.getElementById(input.getAttribute('aria-controls')!)!)
    const options = within(list).getAllByRole('option', { hidden: true }).map((option) => option.textContent)
    expect(options).toEqual(['Passende Haupttätigkeit des jeweiligen Mitarbeiters', 'Abriss / Baubeginn'])
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
    // The notification offers to take it back (it closes itself after a few seconds, so only its appearance counts).
    await screen.findByRole('button', { name: 'Rückgängig' }, { timeout: 15000 })
    expect(screen.queryByText('2 Felder ausgewählt')).not.toBeInTheDocument()
  })

  it('cancels an open activity of a site from the plan, with a way back', async () => {
    const user = userEvent.setup()
    const werner = plan.sites.find((site) => site.id === 12)!
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/sites/12/tasks/')) {
        const { notNeeded } = JSON.parse(String(init?.body)) as { notNeeded: boolean }
        const activity = url.split('/').pop()
        return new Response(
          JSON.stringify({ ...werner, tasks: werner.tasks.map((task) => (task.activity === activity ? { ...task, notNeeded } : task)) }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify(plan), { status: 200 })
    })
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)

    const annaTasks = () => screen.getAllByRole('row').find((row) => row.textContent?.startsWith('Anna'))!.querySelector<HTMLElement>('.tasks')!
    await user.click(within(annaTasks()).getByRole('button', { name: /Familie Werner/ }))
    await user.click(await screen.findByRole('button', { name: 'Stornieren', hidden: true }))
    await waitFor(() => expect(within(annaTasks()).queryByRole('button', { name: /Familie Werner/ })).not.toBeInTheDocument())
    const put = fetchMock.mock.calls.find(([url]) => url === '/api/sites/12/tasks/Abriss')!
    expect(JSON.parse(String(put[1].body))).toEqual({ estimatedDays: 1, notNeeded: true })

    await user.click(await screen.findByRole('button', { name: 'Rückgängig' }, { timeout: 15000 }))
    expect(await within(annaTasks()).findByRole('button', { name: /Familie Werner/ })).toBeInTheDocument()
  })

  describe('right click on a cell', () => {
    const batch = () => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')
      return call ? JSON.parse(String(call[1].body)) : null
    }
    const menu = async (label: RegExp) => {
      fireEvent.contextMenu(cell(label))
      return within(await screen.findByRole('menu'))
    }

    it('copies a cell and pastes it into another; who cannot do the activity gets their own', async () => {
      const user = userEvent.setup()
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)

      // Nothing to paste yet, nothing to copy on an empty cell.
      let items = await menu(/Bernd, Mittwoch, 04.03.2026/)
      expect(items.getByRole('menuitem', { name: 'Einfügen' })).toBeDisabled()
      expect(items.getByRole('menuitem', { name: 'Kopieren' })).toBeDisabled()
      await user.keyboard('{Escape}')

      items = await menu(/Anna, Montag, 02.03.2026/)
      await user.click(items.getByRole('menuitem', { name: 'Kopieren' }))
      items = await menu(/Bernd, Mittwoch, 04.03.2026/)
      await user.click(items.getByRole('menuitem', { name: 'Einfügen' }))

      await waitFor(() => expect(batch()).not.toBeNull())
      // Anna's split day: Fliesen and Trockenbau, which Bernd does not do: he gets Sanitär.
      expect(batch()).toEqual([
        {
          employeeId: 2,
          date: '2026-03-04',
          entries: [
            expect.objectContaining({ siteId: 10, activity: 'Sanitaer', startTime: '08:00:00' }),
            expect.objectContaining({ siteId: 11, activity: 'Sanitaer', startTime: '11:00:00' }),
          ],
        },
      ])
    })

    it('adds what is pasted to the entries of the day, without a site twice', async () => {
      const user = userEvent.setup()
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)

      let items = await menu(/Anna, Montag, 02.03.2026/)
      await user.click(items.getByRole('menuitem', { name: 'Kopieren' }))
      // Bernd is at Meier on Tuesday already: only Schulze is added.
      items = await menu(/Bernd, Dienstag, 03.03.2026/)
      await user.click(items.getByRole('menuitem', { name: 'Einfügen' }))

      await waitFor(() => expect(batch()).not.toBeNull())
      expect(batch()).toEqual([
        {
          employeeId: 2,
          date: '2026-03-03',
          entries: [expect.objectContaining({ siteId: 11 }), expect.objectContaining({ siteId: 10, activity: 'Sanitaer' })],
        },
      ])
    })

    it('cuts a cell and pastes it into all selected cells, emptying the source', async () => {
      const user = userEvent.setup()
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)

      let items = await menu(/Bernd, Dienstag, 03.03.2026/)
      await user.click(items.getByRole('menuitem', { name: 'Ausschneiden' }))

      await user.keyboard('{Control>}')
      await user.click(cell(/Bernd, Mittwoch, 04.03.2026/))
      await user.click(cell(/Bernd, Donnerstag, 05.03.2026/))
      await user.keyboard('{/Control}')
      items = await menu(/Bernd, Donnerstag, 05.03.2026/)
      await user.click(items.getByRole('menuitem', { name: 'Einfügen in 2 Felder' }))

      await waitFor(() => expect(batch()).not.toBeNull())
      expect(batch()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ employeeId: 2, date: '2026-03-04', entries: [expect.objectContaining({ siteId: 11 })] }),
          expect.objectContaining({ employeeId: 2, date: '2026-03-05', entries: [expect.objectContaining({ siteId: 11 })] }),
          { employeeId: 2, date: '2026-03-03', entries: [] },
        ]),
      )
      expect(batch()).toHaveLength(3)
    })
  })

  describe('drag and drop', () => {
    const batch = () => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')
      return call ? JSON.parse(String(call[1].body)) : null
    }
    const dropOn = (source: Element, target: Element) => {
      fireEvent.dragStart(source)
      // A cell that takes the item cancels the dragover (that is how the browser knows it may drop).
      const taken = !fireEvent.dragOver(target)
      fireEvent.drop(target)
      fireEvent.dragEnd(source)
      return taken
    }
    const rowOf = (name: string) => screen.getAllByRole('row').find((row) => row.textContent?.startsWith(name))!

    it('moves an entry to another day and plans an open activity on the cell it is dropped on', async () => {
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)

      const chip = within(cell(/Bernd, Dienstag, 03.03.2026/)).getAllByText('Familie Meier')[0].closest('.chip')!
      // Its own cell and anything outside the plan do not take it.
      expect(dropOn(chip, cell(/Bernd, Dienstag, 03.03.2026/).closest('td')!)).toBe(false)
      expect(dropOn(chip, screen.getByRole('searchbox', { name: 'Baustellen-Filter' }))).toBe(false)
      expect(batch()).toBeNull()

      expect(dropOn(chip, cell(/Bernd, Donnerstag, 05.03.2026/).closest('td')!)).toBe(true)
      await waitFor(() => expect(batch()).not.toBeNull())
      expect(batch()).toEqual([
        { employeeId: 2, date: '2026-03-03', entries: [] },
        expect.objectContaining({ employeeId: 2, date: '2026-03-05', entries: [expect.objectContaining({ siteId: 11 })] }),
      ])
    })

    it('plans an open activity on the employee and day it is dropped on, if the employee can do it', async () => {
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)

      // Anna's open Abriss at Werner, dropped on Bernd (who does Abriss as well).
      const box = within(rowOf('Anna').querySelector<HTMLElement>('.tasks')!).getByRole('button', { name: /Familie Werner/ })
      expect(dropOn(box, cell(/Bernd, Mittwoch, 04.03.2026/).closest('td')!)).toBe(true)
      await waitFor(() => expect(batch()).not.toBeNull())
      expect(batch()).toEqual([
        expect.objectContaining({
          employeeId: 2,
          date: '2026-03-04',
          entries: [expect.objectContaining({ siteId: 12, activity: 'Abriss' })],
        }),
      ])
    })

    it('in the plan by site moves an employee to another site, and asks who goes for a dropped activity', async () => {
      const user = userEvent.setup()
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)
      await user.click(screen.getByRole('radio', { name: 'Nach Baustelle' }))

      // An open activity only goes onto a day of its own site; there the employees are asked for.
      const box = within(rowOf('Familie Werner').querySelector<HTMLElement>('.tasks')!).getByRole('button', { name: /Abriss/ })
      const werner = screen.getByRole('button', { name: /Familie Werner, Donnerstag, 05.03.2026/ }).closest('td')!
      const meier = screen.getByRole('button', { name: /Familie Meier, Donnerstag, 05.03.2026/ }).closest('td')!
      expect(dropOn(box, meier)).toBe(false)
      expect(dropOn(box, werner)).toBe(true)
      expect(await screen.findByText('Abriss / Baubeginn einplanen')).toBeInTheDocument()
      await user.click(screen.getAllByLabelText(/^Mitarbeiter/).find((element) => element.tagName === 'INPUT')!)
      await user.click(await screen.findByRole('option', { name: 'Anna', hidden: true }))
      await user.click(screen.getByRole('button', { name: 'Einplanen', hidden: true }))
      await waitFor(() => expect(batch()).not.toBeNull())
      expect(batch()).toEqual([
        expect.objectContaining({
          employeeId: 1,
          date: '2026-03-05',
          entries: [expect.objectContaining({ siteId: 12, activity: 'Abriss' })],
        }),
      ])
      fetchMock.mockClear()

      // Bernd from Meier on Tuesday to Schulze on Wednesday, with his main activity there.
      const chip = within(screen.getByRole('button', { name: /Familie Meier, Dienstag, 03.03.2026/ }))
        .getAllByText('Bernd')[0]
        .closest('.chip')!
      const schulze = screen.getByRole('button', { name: /Familie Schulze, Mittwoch, 04.03.2026/ }).closest('td')!
      expect(dropOn(chip, schulze)).toBe(true)
      await waitFor(() => expect(batch()).not.toBeNull())
      expect(batch()).toEqual([
        { employeeId: 2, date: '2026-03-03', entries: [] },
        expect.objectContaining({
          employeeId: 2,
          date: '2026-03-04',
          entries: [expect.objectContaining({ siteId: 10, activity: 'Sanitaer' })],
        }),
      ])
    })

    it('gives employees nothing to drag', async () => {
      renderWithProviders(<PlanPage year={2026} canEdit={false} />)
      await screen.findByText(/KW 10/)
      const chip = within(cell(/Bernd, Dienstag, 03.03.2026/)).getAllByText('Familie Meier')[0].closest('.chip')!
      expect(chip).not.toHaveAttribute('draggable')
      expect(dropOn(chip, cell(/Bernd, Donnerstag, 05.03.2026/).closest('td')!)).toBe(false)
    })
  })
})
