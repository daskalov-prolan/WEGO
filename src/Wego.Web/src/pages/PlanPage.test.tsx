import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, Plan } from '../api/types'
import { byText, renderWithProviders } from '../test-utils'
import { PlanPage } from './PlanPage'
import { setClip } from '../lib/clipboard'

const noAddress = { client: null, street: null, houseNumber: null, addressAddition: null, postalCode: null, city: null, nameSource: 'Auftraggeber' as const, description: null, plannedStart: null, plannedEnd: null, status: 'Bauphase' as const, tasks: [], labelProjectNumber: null, clientPhone: null }

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
  // The clipboard is shared by all plan views: empty for each test.
  setClip(null)
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

    expect(await screen.findByText(byText('KW 10–11 · 02.03.–15.03.2026'))).toBeInTheDocument()
    const monday = cell(/Anna, Montag, 02.03.2026/)
    expect(within(monday).getByText('8–10 Uhr')).toBeInTheDocument()
    expect(within(monday).getByText('11–13 Uhr')).toBeInTheDocument()
    // Four hours on sites: the rest of the day shows as free.
    expect(within(monday).getByTitle('verfügbar: dieser Teil des Tages ist frei')).toBeInTheDocument()
    expect(within(cell(/Bernd, Dienstag, 03.03.2026/)).queryByText('verfügbar')).not.toBeInTheDocument()
    // The short form for narrow screens names the first site and counts the rest.
    expect(within(monday).getByText('+1')).toBeInTheDocument()

    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Anna', 'Bernd'])
    expect(document.getElementById('col-2026-03-02')).toHaveTextContent('Mo 02.03')
  })

  it('finds a site by its name and jumps to its days, marking its entries', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await user.type(screen.getByPlaceholderText('Suchen: Kunde, Baustelle, Adresse'), 'werner')
    // Its only day lies before today: the last one is offered.
    expect(await screen.findByText(/1 Tag 2026, zuletzt Fr 20.02.2026/)).toBeInTheDocument()
    await user.click(screen.getByText(/1 Tag 2026, zuletzt/))

    expect(screen.getByRole('status', { name: 'Suchergebnis' })).toHaveTextContent('Familie Werner')
    await waitFor(() => expect(document.querySelector('[data-entry-id="6"]')).toHaveClass('found'))
    expect(document.querySelector('[data-entry-id="1"]')).not.toHaveClass('found')

    await user.click(screen.getByRole('button', { name: 'Suche beenden' }))
    expect(document.querySelector('[data-entry-id="6"]')).not.toHaveClass('found')
  })

  it('moves by week and by month', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    expect(screen.getByText(byText('KW 11–12 · 09.03.–22.03.2026'))).toBeInTheDocument()
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
    // Under "Ansicht", with the size.
    await userEvent.click(screen.getByRole('button', { name: /^Ansicht/ }))
    await userEvent.click(await screen.findByRole('switch', { name: 'Wochenenden ausblenden' }))
    expect(table()).not.toHaveClass('fold-weekends')
    expect(localStorage.getItem('wego.plan.showWeekends')).toBe('true')
  })

  it('on a phone only pages by week with ‹ Heute ›, weekends narrow', async () => {
    const wide = window.matchMedia
    window.matchMedia = ((query: string) => ({ ...wide(query), matches: query.includes('max-width: 720px') })) as typeof window.matchMedia
    try {
      localStorage.setItem('wego.plan.showWeekends', 'true')
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findAllByText('Familie Schulze')

      expect(screen.getByRole('button', { name: 'Heute' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Zurück' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Weiter' })).toBeInTheDocument()
      expect(screen.queryByRole('radio', { name: 'Monat' })).not.toBeInTheDocument()
      expect(screen.queryByText(/KW 10/)).not.toBeInTheDocument()
      expect(screen.queryByRole('switch', { name: 'Wochenenden ausblenden' })).not.toBeInTheDocument()
      expect(document.querySelector('table.timeline')).toHaveClass('fold-weekends')
    } finally {
      window.matchMedia = wide
      localStorage.removeItem('wego.plan.showWeekends')
    }
  })

  it('selects and deselects all employees at once', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    await user.click(screen.getByRole('button', { name: 'Mitarbeiter auswählen (2/2)' }))
    await user.click(await screen.findByRole('button', { name: 'Alle abwählen', hidden: true }))
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Mitarbeiter auswählen (0/2)', hidden: true })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Alle auswählen', hidden: true }))
    expect(screen.getAllByRole('rowheader')).toHaveLength(2)
  })

  it('opens the page of a site from the right-click menu of an entry, and comes back to the same week', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/plan'
    const { unmount } = renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    await screen.findByText(/KW 11/)

    const monday = cell(/Anna, Montag, 02.03.2026/)
    fireEvent.contextMenu(within(monday).getAllByText('Familie Meier')[0].closest('.chip')!)
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Baustelle öffnen: Familie Meier' }))

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

    // Rows by Baubeginn; without one (as all here) in the order of the alphabet.
    // Done sites show as well (Altbau).
    const rows = screen.getAllByRole('rowheader').map((th) => th.textContent)
    expect(rows.filter((name) => name !== 'Altbau')).toEqual(['Familie Meier', 'Familie Schulze', 'Familie Werner'])
    expect(rows).toContain('Altbau')
    expect(screen.queryByRole('switch', { name: 'Nur aktive' })).not.toBeInTheDocument()
    // No hint about work before today any more.
    expect(screen.queryByRole('button', { name: /Frühere Einsätze/ })).not.toBeInTheDocument()
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
  it('shows one phase at a time: its employees and sites, work of the other phase pale', async () => {
    const offer = { ...noAddress, status: 'Angebot' as const, plannedStart: '2026-03-10' }
    const phases: Plan = {
      ...plan,
      employees: [
        ...plan.employees,
        // A planner with a row in the plan, but no work on sites.
        { id: 3, name: 'Clara', mainActivity: null, additionalActivities: [], isPlaner: true, isCraftsman: false },
        // A craftsman: everything on a site, but no offer work.
        { id: 5, name: 'Otto', mainActivity: null, additionalActivities: [] },
        // A planner who builds as well.
        { id: 6, name: 'Petra', mainActivity: null, additionalActivities: [], isPlaner: true },
      ],
      // A planner without a column of their own in the plan.
      planners: [{ id: 4, name: 'Paula', mainActivity: null, additionalActivities: [], isPlaner: true, isCraftsman: false }],
      sites: [...plan.sites, { id: 14, name: 'Familie Neu', ...offer }],
      entries: [
        ...plan.entries,
        { ...entry(8, 2, '2026-03-04', 14, 'Familie Neu', null, null), activity: 'Objektauswahl' },
        { ...entry(9, 2, '2026-03-05', 14, 'Familie Neu', '09:00', '10:00'), activity: 'Besichtigung' },
      ],
    }
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(phases), { status: 200 }))
    const user = userEvent.setup()
    const { rerender } = renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    // Bauphase by default: only who can build, and work of the offer phase stays visible but pale.
    expect(screen.getByRole('group', { name: 'Tätigkeiten der Bauphase' })).toBeInTheDocument()
    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Anna', 'Bernd', 'Otto', 'Petra'])
    const offerWork = within(cell(/Bernd, Mittwoch, 04.03.2026/)).getAllByText('Familie Neu')[0].closest('.chip')
    expect(offerWork).toHaveClass('dimmed')
    // Visits are the exception: one card "Besichtigung" in full colour, so that they are seen at once.
    const visit = within(cell(/Bernd, Donnerstag, 05.03.2026/)).getAllByText('Familie Neu')[0].closest('.chip')
    expect(visit).toHaveClass('chip-visit')
    expect(visit).not.toHaveClass('dimmed')
    expect(within(visit as HTMLElement).getByText('1 Kunde')).toBeInTheDocument()
    expect(within(visit as HTMLElement).getByText('09:00 – 10:00')).toBeInTheDocument()
    // Only the two phases to choose: no done or cancelled, and the activities are no filters.
    expect(screen.queryByText('Abgeschlossen')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Endmontage' })).not.toBeInTheDocument()

    // The offer phase, from the menu: all planners (also those without a column), and only them.
    rerender(<PlanPage year={2026} phase="Angebot" canEdit={false} />)
    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Clara', 'Petra', 'Paula'])

    // By site: the sites in the offer phase.
    await user.click(screen.getByRole('radio', { name: 'Nach Baustelle' }))
    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Familie Neu'])
  })

  it('shows the construction phase to whoever may not see the offer phase, even when asked for it', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...plan, offerPhase: false }), { status: 200 }))
    renderWithProviders(<PlanPage year={2026} phase="Angebot" canEdit={false} />)
    await screen.findByText(/KW 10/)

    expect(screen.getByRole('group', { name: 'Tätigkeiten der Bauphase' })).toBeInTheDocument()
    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Anna', 'Bernd'])
  })

  it('shows entries without the sign of their activity and has no column of unplanned activities', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)

    // The customer name only, no sign of the activity in front.
    const monday = cell(/Anna, Montag, 02.03.2026/)
    expect(monday.querySelector('.chip [data-activity]')).toBeNull()
    expect(screen.queryByText('Ungeplant')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Nach Baustelle' }))
    expect(screen.queryByText('Ungeplant')).not.toBeInTheDocument()
    expect(document.querySelector('.tasks')).toBeNull()
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

  it('zooms out to the month (no whole year any more) and marks holidays', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)

    expect(screen.queryByRole('radio', { name: 'Jahr' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Monat' }))

    expect(document.querySelector('table.timeline')).toHaveClass('zoom-month')
    expect(cell(/Anna, Montag, 02.03.2026/)).toHaveAttribute('title', 'Familie Schulze – Fliesenarbeiten / Familie Meier – Trockenbau')
    expect(document.getElementById('col-2026-03-08')).toHaveClass('public-holiday')
    expect(document.getElementById('col-2026-02-03')).toHaveClass('holiday')
  })

  it('pages past December into January of the next year and back before January', async () => {
    const onYearChange = vi.fn()
    sessionStorage.setItem('wego.plan.returnTo', '2026-12-21')
    const { unmount } = renderWithProviders(<PlanPage year={2026} canEdit={false} onYearChange={onYearChange} />)
    await screen.findByText(/KW 52/)
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    expect(onYearChange).toHaveBeenCalledWith(2027)
    expect(sessionStorage.getItem('wego.plan.returnTo')).toBe('2027-01-01')
    unmount()

    onYearChange.mockClear()
    sessionStorage.setItem('wego.plan.returnTo', '2026-01-05')
    renderWithProviders(<PlanPage year={2026} canEdit={false} onYearChange={onYearChange} />)
    await screen.findByText(/KW 2/)
    await userEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(onYearChange).toHaveBeenCalledWith(2025)
    expect(sessionStorage.getItem('wego.plan.returnTo')).toBe('2025-12-29')
  })

  it('opens a read-only day for employees and the editor for planners', async () => {
    const { unmount } = renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await userEvent.click(await screen.findByRole('button', { name: /Anna, Montag, 02.03.2026/ }))
    expect(await screen.findByRole('button', { name: 'Schließen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()
    unmount()

    // Planners: a click marks, a double click opens the day.
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await userEvent.click(await screen.findByRole('button', { name: /Anna, Montag, 02.03.2026/ }))
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()
    await userEvent.dblClick(screen.getByRole('button', { name: /Anna, Montag, 02.03.2026/ }))
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeInTheDocument()
  })

  it('starts a site entry with the main activity of the craftsman and shows the address and phone of the customer', async () => {
    const withAddress = (site: Plan['sites'][number]) =>
      site.id === 10
        ? { ...site, street: 'Hauptstraße', houseNumber: '12', postalCode: '13125', city: 'Berlin', clientPhone: '030 123 45' }
        : site
    fetchMock.mockImplementation(async (url: string) =>
      new Response(url === '/api/plan/batch' ? '[]' : JSON.stringify({ ...plan, sites: plan.sites.map(withAddress) }), { status: 200 }),
    )
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await user.dblClick(await screen.findByRole('button', { name: /Bernd, Mittwoch, 04.03.2026/ }))

    const input = (label: RegExp) => screen.getAllByLabelText(label).find((element) => element.tagName === 'INPUT')!
    await screen.findAllByLabelText(/^Baustelle/)
    // No buttons of recent sites, no field for the activity, no Urlaub or Krank (those are above the plan).
    expect(screen.queryByText('Baustellen dieser Wochen')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tätigkeit')).not.toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Urlaub' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('hier wichtige Hinweise oder Notizen eintragen')).toBeInTheDocument()
    await user.click(input(/^Baustelle/))
    await user.click(await screen.findByRole('option', { name: /Familie Schulze/, hidden: true }))
    // Bernd's main activity (Verwaltung) is Sanitär.
    expect(screen.getByText('1 · Sanitär · Familie Schulze')).toBeInTheDocument()
    expect(document.querySelector('.site-contact')).toHaveTextContent('Adresse: Hauptstraße 12, 13125 Berlin')
    // At the desk no button that dials.
    expect(screen.queryByRole('link', { name: 'Anrufen: 030 123 45' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))[0].entries).toEqual([
      expect.objectContaining({ type: 'Baustelle', siteId: 10, activity: 'Sanitaer' }),
    ])
  })

  it('puts a site created from a dragged offer activity onto the day at once, with that activity', async () => {
    const phases: Plan = {
      ...plan,
      employees: [...plan.employees, { id: 3, name: 'Clara', mainActivity: null, additionalActivities: [], isPlaner: true, isCraftsman: false }],
    }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/plan/batch') return new Response('[]', { status: 200 })
      if (url === '/api/sites' && init?.method === 'POST')
        return new Response(JSON.stringify({ ...noAddress, id: 50, name: 'Familie Neu', client: 'Familie Neu', status: 'Angebot' }), {
          status: 201,
        })
      if (url === '/api/sites/planners') return new Response(JSON.stringify([{ id: 7, name: 'Planer G', isMe: true }]), { status: 200 })
      return new Response(JSON.stringify(phases), { status: 200 })
    })
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} phase="Angebot" canEdit />)
    await screen.findByText(/KW 10/)

    const legend = screen.getByRole('group', { name: 'Tätigkeiten der Angebotsphase' })
    const choice = within(legend).getByText('Objektauswahl').closest('.flow-step')!
    const monday = cell(/Clara, Montag, 02.03.2026/).closest('td')!
    fireEvent.dragStart(choice)
    fireEvent.dragOver(monday)
    fireEvent.drop(monday)
    fireEvent.dragEnd(choice)

    await user.click(await screen.findByRole('button', { name: 'Neue Baustelle anlegen' }))
    const client = screen.getAllByLabelText(/^Auftraggeber/).find((element) => element.getAttribute('type') !== 'radio')!
    await user.type(client, 'Familie Neu')
    await user.click(screen.getAllByLabelText(/Zuständiger Planer/).find((element) => element.tagName === 'INPUT')!)
    await user.click(await screen.findByRole('option', { name: 'Planer G', hidden: true }))
    await user.click(within(screen.getByRole('dialog', { name: 'Neue Baustelle' })).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))).toEqual([
      { employeeId: 3, date: '2026-03-02', entries: [expect.objectContaining({ siteId: 50, activity: 'Objektauswahl' })] },
    ])
  })

  it('opens the day when an activity of the construction phase is dragged onto it', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)
    const legend = screen.getByRole('group', { name: 'Tätigkeiten der Bauphase' })
    const demolition = within(legend).getByText('Abriss / Baubeginn').closest('.flow-step')!
    const day = cell(/Anna, Donnerstag, 05.03.2026/).closest('td')!
    fireEvent.dragStart(demolition)
    expect(fireEvent.dragOver(day)).toBe(false)
    fireEvent.drop(day)
    fireEvent.dragEnd(demolition)
    expect(await screen.findByText('1 · Abriss / Baubeginn · Baustelle wählen oder neu anlegen')).toBeInTheDocument()
  })

  it('changes what an employee does on a site by dragging an activity onto the entry', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)
    const legend = screen.getByRole('group', { name: 'Tätigkeiten der Bauphase' })
    const demolition = within(legend).getByText('Abriss / Baubeginn').closest('.flow-step')!
    // Bernd at Meier on Tuesday.
    const chip = within(cell(/Bernd, Dienstag, 03.03.2026/)).getAllByText('Familie Meier')[0].closest('.chip')!
    fireEvent.dragStart(demolition)
    expect(fireEvent.dragOver(chip)).toBe(false)
    fireEvent.drop(chip)
    fireEvent.dragEnd(demolition)

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))).toEqual([
      { employeeId: 2, date: '2026-03-03', entries: [expect.objectContaining({ siteId: 11, activity: 'Abriss' })] },
    ])
    // The day did not open: the drop was taken by the entry.
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()

    // Every craftsman does every activity of the construction phase: Anna's entry takes Fliesen as well.
    const tiles = within(legend).getByText('Fliesenarbeiten').closest('.flow-step')!
    const annas = within(cell(/Anna, Montag, 02.03.2026/)).getAllByText('Familie Schulze')[0].closest('.chip')!
    fireEvent.dragStart(tiles)
    expect(fireEvent.dragOver(annas)).toBe(false)
    fireEvent.dragEnd(tiles)
  })

  it('shows the half of a day without a site as available, a visit before its site as the visit', async () => {
    const free = (id: number, employeeId: number, activity: string): Entry => ({
      ...entry(id, employeeId, '2026-03-05', 0, '', '12:00:00', '16:00:00'),
      siteId: null,
      siteName: null,
      activity,
    })
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ ...plan, entries: [...plan.entries, free(30, 2, 'Sanitaer'), free(31, 1, 'Besichtigung')] }), {
        status: 200,
      }),
    )
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)
    expect(within(cell(/Bernd, Donnerstag, 05.03.2026/)).getAllByText('verfügbar')).not.toHaveLength(0)
    expect(within(cell(/Bernd, Donnerstag, 05.03.2026/)).queryByText('Sanitär')).not.toBeInTheDocument()
    expect(within(cell(/Anna, Donnerstag, 05.03.2026/)).getAllByText('Besichtigung')).not.toHaveLength(0)
  })

  it('has no Urlaub or Krank to drag above the plan: they are entered under Verwaltung', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit canAbsence />)
    await screen.findByText(/KW 10/)
    expect(screen.queryByRole('group', { name: 'Abwesenheit eintragen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Urlaub' })).not.toBeInTheDocument()
  })

  it('jumps to a month chosen from the time in view', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)
    await user.click(screen.getByRole('button', { name: 'Zu Monat oder Jahr springen' }))
    await user.click(await screen.findByRole('button', { name: 'Jun' }))
    expect(await screen.findByText(/KW 2[23]/)).toBeInTheDocument()
  })

  it('shows no vacation count in the plan: that is under Mein Bereich', async () => {
    const me = { id: 2, name: 'Bernd', userName: 'bernd', role: 'Handwerker' as const, showInPlan: true, mustChangePassword: false }
    renderWithProviders(<PlanPage year={2026} canEdit={false} user={me} />)
    await screen.findByText(/KW 10/)
    expect(screen.queryByLabelText('Eigene Urlaubstage')).not.toBeInTheDocument()
    expect(screen.queryByText(/Urlaubstagen/)).not.toBeInTheDocument()
  })
  it('offers what the selected employees can do when filling several cells with a site', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await screen.findByText(/KW 10/)

    await user.keyboard('{Control>}')
    await user.click(cell(/Anna, Mittwoch, 04.03.2026/))
    await user.click(cell(/Anna, Donnerstag, 05.03.2026/))
    await user.keyboard('{/Control}')
    await user.click(screen.getByRole('button', { name: 'Baustelle …' }))

    // Anna is a craftsman: all activities of the construction phase.
    await screen.findByText('Baustelle für 2 Felder')
    const input = screen.getAllByLabelText('Tätigkeit').find((element) => element.tagName === 'INPUT')!
    await user.click(input)
    const list = await waitFor(() => document.getElementById(input.getAttribute('aria-controls')!)!)
    const options = within(list).getAllByRole('option', { hidden: true }).map((option) => option.textContent)
    expect(options).toEqual([
      'Erste passende Tätigkeit des jeweiligen Mitarbeiters',
      'Abriss / Baubeginn',
      'Trockenbau',
      'Sanitär',
      'RenoDeco-Platten',
      'Fliesenarbeiten',
      'Endmontage',
    ])
  })

  it('lets planners select several cells and fill them in one go', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit canAbsence />)
    await screen.findByText(/KW 10/)

    await user.keyboard('{Control>}')
    await user.click(cell(/Bernd, Mittwoch, 04.03.2026/))
    await user.click(cell(/Bernd, Donnerstag, 05.03.2026/))
    await user.keyboard('{/Control}')

    expect(screen.getByText('2 Felder ausgewählt')).toBeInTheDocument()
    // Filled with a site through "Baustelle …" is tested below; here they are emptied.
    await user.click(screen.getByRole('button', { name: 'Leeren' }))

    const batches = () => fetchMock.mock.calls.filter(([url]) => url === '/api/plan/batch').map(([, init]) => JSON.parse(String(init.body)))
    await waitFor(() => expect(batches()).toHaveLength(1))
    expect(batches()[0]).toEqual([
      { employeeId: 2, date: '2026-03-04', entries: [] },
      { employeeId: 2, date: '2026-03-05', entries: [] },
    ])
    expect(screen.queryByText('2 Felder ausgewählt')).not.toBeInTheDocument()

    // Taken back with the button above the plan, and done again.
    expect(screen.getByRole('button', { name: /Wiederherstellen/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Rückgängig/ }))
    await waitFor(() => expect(batches()).toHaveLength(2))
    await waitFor(() => expect(screen.getByRole('button', { name: /Rückgängig/ })).toBeDisabled())
    await user.click(screen.getByRole('button', { name: /Wiederherstellen/ }))
    await waitFor(() => expect(batches()).toHaveLength(3))
    expect(batches()[2]).toEqual(batches()[0])
  })

  it('splits a day into two halves of four hours, with times in full and half hours only', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await user.dblClick(await screen.findByRole('button', { name: /Bernd, Mittwoch, 04.03.2026/ }))

    await user.click(await screen.findByRole('button', { name: '½ Tag' }))
    const times = (label: string) =>
      screen.getAllByLabelText(label).filter((element) => element.tagName === 'INPUT').map((input) => (input as HTMLInputElement).value)
    expect(times('von')).toEqual(['07:30', '12:00'])
    expect(times('bis')).toEqual(['11:30', '16:00'])

    // The times to choose from: full and half hours; the end only after the start.
    const optionsOf = async (label: string) => {
      const input = screen.getAllByLabelText(label).find((element) => element.tagName === 'INPUT')!
      await user.click(input)
      const list = await waitFor(() => document.getElementById(input.getAttribute('aria-controls')!)!)
      return within(list).getAllByRole('option', { hidden: true }).map((option) => option.textContent)
    }
    const from = await optionsOf('von')
    expect(from.slice(0, 4)).toEqual(['06:00', '06:30', '07:00', '07:30'])
    expect(from.every((time) => /:(00|30)$/.test(time ?? ''))).toBe(true)
    await user.keyboard('{Escape}')
    expect((await optionsOf('bis')).slice(0, 2)).toEqual(['08:00', '08:30'])
  })

  it('keeps the other half of a split day free, and swaps the two halves', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await user.dblClick(await screen.findByRole('button', { name: /Bernd, Dienstag, 03.03.2026/ }))

    await user.click(await screen.findByRole('button', { name: '½ Tag' }))
    await user.click(screen.getByRole('checkbox', { name: 'Bleibt verfügbar (keine Baustelle)' }))
    // Free in the morning, Meier in the afternoon: the times stay where they are.
    await user.click(screen.getByRole('button', { name: 'Eintrag 1 und 2 tauschen' }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))[0].entries).toEqual([
      expect.objectContaining({ siteId: null, activity: null, startTime: '07:30:00', endTime: '11:30:00' }),
      expect.objectContaining({ siteId: 11, startTime: '12:00:00', endTime: '16:00:00' }),
    ])
  })

  it('widens a half day to the whole day without touching the times', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    await user.dblClick(await screen.findByRole('button', { name: /Bernd, Dienstag, 03.03.2026/ }))
    await user.click(await screen.findByRole('button', { name: '½ Tag' }))
    await user.click(screen.getByRole('checkbox', { name: 'Bleibt verfügbar (keine Baustelle)' }))

    await user.click(screen.getAllByRole('button', { name: 'Auf den ganzen Tag ausweiten' })[0])
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))[0].entries).toEqual([
      expect.objectContaining({ siteId: 11, startTime: '07:00:00', endTime: '16:00:00' }),
    ])
  })

  it('shows the note of an entry when pointing at its sign', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit={false} />)
    await screen.findByText(/KW 10/)
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    // One hint only, the note instead of site and activity.
    const sign = within(cell(/Bernd, Donnerstag, 12.03.2026/)).getAllByRole('img', { name: 'mit Notiz' })[0]
    expect(sign.closest('[title]')).toHaveAttribute('title', 'mit 2 Helfern')
  })

  it('plans a site in the free half of a day by a click on "verfügbar", and moves half a day there by dragging', async () => {
    const halfDay: Plan = { ...plan, entries: [{ ...entry(20, 2, '2026-03-04', 12, 'Familie Werner', '12:00:00', '16:00:00'), activity: 'Fliesen' }] }
    fetchMock.mockImplementation(async (url: string) =>
      new Response(url === '/api/plan/batch' ? '[]' : JSON.stringify(halfDay), { status: 200 }),
    )
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    const wednesday = await screen.findByRole('button', { name: /Bernd, Mittwoch, 04.03.2026/ })
    // In the afternoon on the site: the free morning comes first.
    const chips = [...wednesday.querySelectorAll('.cell-full .chip')].map((chip) => chip.textContent)
    expect(chips[0]).toBe('verfügbar')

    // A click on "verfügbar" opens the day with a new row for the free half.
    await user.click(within(wednesday).getByText('verfügbar'))
    const times = (label: string) =>
      screen.getAllByLabelText(label).filter((element) => element.tagName === 'INPUT').map((input) => (input as HTMLInputElement).value)
    expect(await screen.findByText(/Baustelle wählen oder neu anlegen/)).toBeInTheDocument()
    expect(times('von')).toEqual(['12:00', '07:30'])
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

    // Dragging the site onto the free morning moves it there.
    fireEvent.dragStart(within(wednesday).getAllByText('Familie Werner')[0].closest('.chip')!)
    fireEvent.drop(within(wednesday).getByText('verfügbar').closest('.chip')!)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))[0].entries).toEqual([
      expect.objectContaining({ siteId: 12, startTime: '07:30:00', endTime: '11:30:00' }),
    ])
  })

  it('shows a reserved day of an offer site without Baubeginn framed, and takes no activity on it', async () => {
    const offer = { ...noAddress, id: 30, name: 'Familie Kern', client: 'Familie Kern', status: 'Angebot' as const }
    const reserved: Plan = { ...plan, sites: [...plan.sites, offer], entries: [entry(40, 2, '2026-03-04', 30, 'Familie Kern', null, null)] }
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(reserved), { status: 200 }))
    renderWithProviders(<PlanPage year={2026} canEdit />)
    const wednesday = await screen.findByRole('button', { name: /Bernd, Mittwoch, 04.03.2026/ })

    const chip = within(wednesday).getAllByText('Familie Kern')[0].closest('.chip')!
    expect(chip).toHaveClass('reserved')
    expect(chip).not.toHaveClass('dimmed')

    // An activity dragged onto it: first the Baubeginn.
    fireEvent.dragStart(screen.getAllByText('Fliesenarbeiten')[0].closest('[draggable="true"]')!)
    fireEvent.drop(chip)
    expect(await screen.findByText(/erst den Baubeginn eintragen/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(false)
  })

  it('opens the day with a site to choose in place of a saved "verfügbar"', async () => {
    const kept: Plan = {
      ...plan,
      entries: [
        { ...entry(21, 2, '2026-03-04', 12, 'Familie Werner', '07:30:00', '11:30:00'), siteId: null, siteName: null, activity: null },
        entry(22, 2, '2026-03-04', 12, 'Familie Werner', '12:00:00', '16:00:00'),
      ],
    }
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(kept), { status: 200 }))
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} canEdit />)
    const wednesday = await screen.findByRole('button', { name: /Bernd, Mittwoch, 04.03.2026/ })

    await user.click(within(wednesday).getAllByText('verfügbar')[0])
    expect(await screen.findByText(/Baustelle wählen oder neu anlegen/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Bleibt verfügbar (keine Baustelle)' })).not.toBeChecked()
  })

  it('swaps two sites of a day with their times by dragging one onto the other', async () => {
    renderWithProviders(<PlanPage year={2026} canEdit />)
    const monday = await screen.findByRole('button', { name: /Anna, Montag, 02.03.2026/ })
    const chipOf = (name: string) => within(monday).getAllByText(name)[0].closest('.chip')!

    fireEvent.dragStart(chipOf('Familie Meier'))
    fireEvent.drop(chipOf('Familie Schulze'))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))[0].entries).toEqual([
      expect.objectContaining({ siteId: 11, activity: 'Trockenbau', startTime: '08:00:00', endTime: '10:00:00' }),
      expect.objectContaining({ siteId: 10, activity: 'Fliesen', startTime: '11:00:00', endTime: '13:00:00' }),
    ])
  })

  it('in the offer phase plans a visit by dragging it from the legend onto a day, the site still open', async () => {
    const phases: Plan = {
      ...plan,
      employees: [...plan.employees, { id: 3, name: 'Clara', mainActivity: null, additionalActivities: [], isPlaner: true, isCraftsman: false }],
    }
    fetchMock.mockImplementation(async (url: string) =>
      new Response(url === '/api/plan/batch' ? '[]' : JSON.stringify(phases), { status: 200 }),
    )
    const user = userEvent.setup()
    renderWithProviders(<PlanPage year={2026} phase="Angebot" canEdit />)
    await screen.findByText(/KW 10/)
    // No date field: the plan moves with the arrows and "Heute".
    expect(screen.queryByLabelText('Datum')).not.toBeInTheDocument()

    // The activities of the phase right above the plan, without arrows between them.
    const legend = screen.getByRole('group', { name: 'Tätigkeiten der Angebotsphase' })
    expect([...legend.querySelectorAll('.flow-step')].map((step) => step.textContent)).toEqual([
      'Anfrage',
      'Besichtigung',
      'Objektauswahl',
      'Angebotsübergabe',
    ])
    expect(legend.querySelector('.flow-arrow')).toBeNull()
    const visit = within(legend).getByText('Besichtigung').closest('.flow-step')!
    const monday = cell(/Clara, Montag, 02.03.2026/).closest('td')!
    fireEvent.dragStart(visit)
    expect(fireEvent.dragOver(monday)).toBe(false)
    fireEvent.drop(monday)
    fireEvent.dragEnd(visit)

    // The day opens with the visit as a new row: a site can be chosen or created right there, or left open.
    expect(await screen.findByText('1 · Besichtigung · Baustelle wählen oder neu anlegen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Neue Baustelle anlegen' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/plan/batch')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')!
    expect(JSON.parse(String(call[1].body))).toEqual([
      { employeeId: 3, date: '2026-03-02', entries: [expect.objectContaining({ type: 'Baustelle', siteId: null, activity: 'Besichtigung' })] },
    ])
  })

  describe('marking an entry', () => {
    const batch = () => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/batch')
      return call ? JSON.parse(String(call[1].body)) : null
    }

    it('marks an entry with a click and makes it longer by dragging its right end', async () => {
      const user = userEvent.setup()
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)

      const chip = () => within(cell(/Bernd, Dienstag, 03.03.2026/)).getAllByText('Familie Meier')[0].closest('.chip')!
      await user.click(chip())
      expect(chip()).toHaveClass('marked')
      // No day editor on a single click.
      expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()

      // The right end dragged to Thursday: Wednesday and Thursday come in.
      const thursday = cell(/Bernd, Donnerstag, 05.03.2026/).closest('td')!
      document.elementFromPoint = () => thursday
      fireEvent.pointerDown(chip().querySelector('.stretch-handle.right')!)
      fireEvent.pointerMove(window, { clientX: 10, clientY: 10 })
      expect(thursday).toHaveClass('stretch-add')
      fireEvent.pointerUp(window)

      await waitFor(() => expect(batch()).not.toBeNull())
      expect(batch()).toEqual([
        { employeeId: 2, date: '2026-03-04', entries: [expect.objectContaining({ siteId: 11, note: null })] },
        { employeeId: 2, date: '2026-03-05', entries: [expect.objectContaining({ siteId: 11, note: null })] },
      ])

      // Escape lifts the mark.
      await user.keyboard('{Escape}')
      expect(chip()).not.toHaveClass('marked')
    })

    it('takes the marked stretch to the employee below by dragging its lower edge, overwriting the same time', async () => {
      const user = userEvent.setup()
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)

      const anna = within(cell(/Anna, Montag, 02.03.2026/)).getAllByText('Familie Meier')[0].closest('.chip')!
      await user.click(anna)
      const marked = () => within(cell(/Anna, Montag, 02.03.2026/)).getAllByText('Familie Meier')[0].closest('.chip')!
      const handle = document.querySelector('.chip.marked .stretch-handle.down') ?? marked().querySelector('.stretch-handle.down')
      expect(handle).not.toBeNull()

      // Down onto Bernd's row: his Monday is marked as coming in.
      const bernd = cell(/Bernd, Montag, 02.03.2026/).closest('td')!
      document.elementFromPoint = () => bernd
      fireEvent.pointerDown(handle!)
      fireEvent.pointerMove(window, { clientX: 10, clientY: 10 })
      expect(bernd).toHaveClass('stretch-add')
      fireEvent.pointerUp(window)

      await waitFor(() => expect(batch()).not.toBeNull())
      const monday = batch().find((day: { employeeId: number; date: string }) => day.employeeId === 2 && day.date === '2026-03-02')
      expect(monday.entries).toContainEqual(expect.objectContaining({ siteId: 11, note: null }))
    })

    it('in the plan by site copies an employee onto the following days by dragging the right end', async () => {
      const user = userEvent.setup()
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)
      await user.click(screen.getByRole('radio', { name: 'Nach Baustelle' }))

      const meier = (day: RegExp) => screen.getByRole('button', { name: day })
      const chip = () => within(meier(/Familie Meier, Dienstag, 03.03.2026/)).getAllByText('Bernd')[0].closest('.chip')!
      // A click on the employee marks the entry, it does not open the day.
      await user.click(chip())
      expect(chip()).toHaveClass('marked')
      expect(screen.queryByText('Weitere Mitarbeiter einplanen')).not.toBeInTheDocument()

      const thursday = meier(/Familie Meier, Donnerstag, 05.03.2026/).closest('td')!
      document.elementFromPoint = () => thursday
      fireEvent.pointerDown(chip().querySelector('.stretch-handle.right')!)
      fireEvent.pointerMove(window, { clientX: 10, clientY: 10 })
      expect(thursday).toHaveClass('stretch-add')
      fireEvent.pointerUp(window)

      await waitFor(() => expect(batch()).not.toBeNull())
      expect(batch()).toEqual([
        { employeeId: 2, date: '2026-03-04', entries: [expect.objectContaining({ siteId: 11 })] },
        { employeeId: 2, date: '2026-03-05', entries: [expect.objectContaining({ siteId: 11 })] },
      ])
    })

    it('copies the marked entry with Ctrl+C and pastes it into selected cells with Ctrl+V', async () => {
      const user = userEvent.setup()
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)

      await user.click(within(cell(/Anna, Montag, 02.03.2026/)).getAllByText('Familie Meier')[0].closest('.chip')!)
      await user.keyboard('{Control>}c{/Control}')
      await user.keyboard('{Control>}')
      await user.click(cell(/Bernd, Mittwoch, 04.03.2026/))
      await user.keyboard('{/Control}')
      await user.keyboard('{Control>}v{/Control}')

      await waitFor(() => expect(batch()).not.toBeNull())
      expect(batch()).toEqual([{ employeeId: 2, date: '2026-03-04', entries: [expect.objectContaining({ siteId: 11 })] }])
    })
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

    it('writes a note into the field of an employee, shows its explanation and deletes it', async () => {
      const user = userEvent.setup()
      const withNote = { ...plan, notes: [{ id: 5, employeeId: 1, date: '2026-03-03', title: 'Arzttermin', text: 'Ab 14 Uhr nicht da' }] }
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === '/api/plan/notes') return new Response(JSON.stringify({ id: 6, ...JSON.parse(String(init?.body)) }), { status: 201 })
        if (url === '/api/plan/notes/5') return new Response(null, { status: 204 })
        return new Response(JSON.stringify(withNote), { status: 200 })
      })
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)

      // The title in the field of Anna; pointing at it shows the explanation.
      const note = within(cell(/Anna, Dienstag, 03.03.2026/)).getByText('Arzttermin')
      await user.hover(note)
      expect(await screen.findByText('Ab 14 Uhr nicht da', {}, { timeout: 2000 })).toBeInTheDocument()
      // Anywhere on the field the whole note shows as well, not only right on it.
      expect(cell(/Anna, Dienstag, 03.03.2026/)).toHaveAttribute('title', expect.stringContaining('Notiz: Arzttermin\nAb 14 Uhr nicht da'))
      expect(note).toHaveAttribute('title', '')

      // A right click on a field of an employee offers a note there, independent of the site.
      const items = await menu(/Bernd, Mittwoch, 04.03.2026/)
      await user.click(items.getByRole('menuitem', { name: 'Notiz einfügen' }))
      await user.type(await screen.findByRole('textbox', { name: /Überschrift/ }), 'Werkzeug holen')
      await user.type(screen.getByRole('textbox', { name: /Erklärung/ }), 'Bohrhammer aus dem Lager.')
      await user.click(screen.getByRole('button', { name: 'Speichern' }))

      await waitFor(() => expect(within(cell(/Bernd, Mittwoch, 04.03.2026/)).getByText('Werkzeug holen')).toBeInTheDocument())
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/plan/notes')!
      expect(JSON.parse(String(call[1].body))).toEqual({
        employeeId: 2,
        date: '2026-03-04',
        title: 'Werkzeug holen',
        text: 'Bohrhammer aus dem Lager.',
      })

      // A right click on the note deletes it.
      fireEvent.contextMenu(within(cell(/Anna, Dienstag, 03.03.2026/)).getByText('Arzttermin'))
      await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Notiz löschen: Arzttermin' }))
      await waitFor(() => expect(within(cell(/Anna, Dienstag, 03.03.2026/)).queryByText('Arzttermin')).not.toBeInTheDocument())
    })

    it('copies a field with its note by Strg+C and pastes it by Strg+V into the field clicked last', async () => {
      const withNote = { ...plan, notes: [{ id: 5, employeeId: 1, date: '2026-03-02', title: 'Arzttermin', text: 'ab 14 Uhr' }] }
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === '/api/plan/batch') return new Response('[]', { status: 200 })
        if (url === '/api/plan/notes') return new Response(JSON.stringify({ id: 6, ...JSON.parse(String(init?.body)) }), { status: 201 })
        return new Response(JSON.stringify(withNote), { status: 200 })
      })
      const user = userEvent.setup()
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)

      // A click on the field (not on an entry), then the keys.
      cell(/Anna, Montag, 02.03.2026/).focus()
      await user.keyboard('{Control>}c{/Control}')
      cell(/Bernd, Mittwoch, 04.03.2026/).focus()
      await user.keyboard('{Control>}v{/Control}')

      await waitFor(() => expect(batch()).not.toBeNull())
      expect(batch()).toEqual([
        {
          employeeId: 2,
          date: '2026-03-04',
          entries: [expect.objectContaining({ siteId: 10 }), expect.objectContaining({ siteId: 11 })],
        },
      ])
      await waitFor(() => expect(within(cell(/Bernd, Mittwoch, 04.03.2026/)).getByText('Arzttermin')).toBeInTheDocument())
      const note = fetchMock.mock.calls.find(([url]) => url === '/api/plan/notes')!
      expect(JSON.parse(String(note[1].body))).toEqual({ employeeId: 2, date: '2026-03-04', title: 'Arzttermin', text: 'ab 14 Uhr' })
    })

    it('copies a cell and pastes it into another, with its activities', async () => {
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
      // Anna's split day: Fliesen and Trockenbau, which Bernd does as every craftsman.
      expect(batch()).toEqual([
        {
          employeeId: 2,
          date: '2026-03-04',
          entries: [
            expect.objectContaining({ siteId: 10, activity: 'Fliesen', startTime: '08:00:00' }),
            expect.objectContaining({ siteId: 11, activity: 'Trockenbau', startTime: '11:00:00' }),
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
          entries: [expect.objectContaining({ siteId: 11 }), expect.objectContaining({ siteId: 10, activity: 'Fliesen' })],
        },
      ])
    })

    it('cuts a single entry of a day with several and pastes it elsewhere', async () => {
      const user = userEvent.setup()
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)

      // Right click on the Meier entry of Anna's split Monday.
      const chip = within(cell(/Anna, Montag, 02.03.2026/)).getAllByText('Familie Meier')[0].closest('.chip')!
      fireEvent.contextMenu(chip)
      let items = within(await screen.findByRole('menu'))
      expect(items.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Baustelle öffnen: Familie Meier',
        'Kopieren: Familie Meier',
        'Ausschneiden: Familie Meier',
        'Ganzen Tag kopieren',
        'Ganzen Tag ausschneiden',
        'Einfügen',
        'Löschen: Familie Meier',
        'Ganzen Tag löschen',
        'Notiz einfügen',
      ])
      await user.click(items.getByRole('menuitem', { name: 'Ausschneiden: Familie Meier' }))

      items = await menu(/Bernd, Mittwoch, 04.03.2026/)
      await user.click(items.getByRole('menuitem', { name: 'Einfügen' }))
      await waitFor(() => expect(batch()).not.toBeNull())
      // Bernd gets Meier; Anna keeps Schulze.
      expect(batch()).toEqual(
        expect.arrayContaining([
          { employeeId: 2, date: '2026-03-04', entries: [expect.objectContaining({ siteId: 11 })] },
          { employeeId: 1, date: '2026-03-02', entries: [expect.objectContaining({ siteId: 10 })] },
        ]),
      )
      expect(batch()).toHaveLength(2)
    })

    it('deletes a single entry of a day with several, and the whole day', async () => {
      const user = userEvent.setup()
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)
      const batches = () =>
        fetchMock.mock.calls.filter(([url]) => url === '/api/plan/batch').map(([, init]) => JSON.parse(String(init.body)))

      const chip = within(cell(/Anna, Montag, 02.03.2026/)).getAllByText('Familie Meier')[0].closest('.chip')!
      fireEvent.contextMenu(chip)
      await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Löschen: Familie Meier' }))
      await waitFor(() => expect(batches()).toHaveLength(1))
      expect(batches()[0]).toEqual([{ employeeId: 1, date: '2026-03-02', entries: [expect.objectContaining({ siteId: 10 })] }])

      const items = await menu(/Bernd, Dienstag, 03.03.2026/)
      await user.click(items.getByRole('menuitem', { name: 'Löschen' }))
      await waitFor(() => expect(batches()).toHaveLength(2))
      expect(batches()[1]).toEqual([{ employeeId: 2, date: '2026-03-03', entries: [] }])
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

    it('moves an entry to another day and plans an open activity on the cell it is dropped on', async () => {
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)

      const chip = within(cell(/Bernd, Dienstag, 03.03.2026/)).getAllByText('Familie Meier')[0].closest('.chip')!
      // Its own cell and anything outside the plan do not take it.
      expect(dropOn(chip, cell(/Bernd, Dienstag, 03.03.2026/).closest('td')!)).toBe(false)
      expect(dropOn(chip, screen.getByRole('button', { name: /^Ansicht/ }))).toBe(false)
      expect(batch()).toBeNull()

      expect(dropOn(chip, cell(/Bernd, Donnerstag, 05.03.2026/).closest('td')!)).toBe(true)
      await waitFor(() => expect(batch()).not.toBeNull())
      expect(batch()).toEqual([
        { employeeId: 2, date: '2026-03-03', entries: [] },
        expect.objectContaining({ employeeId: 2, date: '2026-03-05', entries: [expect.objectContaining({ siteId: 11 })] }),
      ])
    })

    it('in the plan by site puts an employee from the buttons on a site, and moves one to another site', async () => {
      const user = userEvent.setup()
      renderWithProviders(<PlanPage year={2026} canEdit />)
      await screen.findByText(/KW 10/)
      // The buttons are only there in the plan by site.
      expect(screen.queryByRole('group', { name: 'Mitarbeiter zum Einplanen' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('radio', { name: 'Nach Baustelle' }))

      // Anna from the buttons onto Werner on Thursday, with her own activity there.
      const anna = within(screen.getByRole('group', { name: 'Mitarbeiter zum Einplanen' })).getByText('Anna')
      const werner = screen.getByRole('button', { name: /Familie Werner, Donnerstag, 05.03.2026/ }).closest('td')!
      // Not where she is already: Anna is at Meier on Monday.
      const meierMonday = screen.getByRole('button', { name: /Familie Meier, Montag, 02.03.2026/ }).closest('td')!
      expect(dropOn(anna, meierMonday)).toBe(false)
      expect(dropOn(anna, werner)).toBe(true)
      await waitFor(() => expect(batch()).not.toBeNull())
      expect(batch()).toEqual([
        expect.objectContaining({
          employeeId: 1,
          date: '2026-03-05',
          entries: [expect.objectContaining({ siteId: 12, activity: 'Abriss' })],
        }),
      ])
      fetchMock.mockClear()

      // Bernd from Meier on Tuesday (no activity yet) to Schulze on Wednesday, with his main activity.
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
