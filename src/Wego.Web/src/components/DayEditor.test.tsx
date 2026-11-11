import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DayEntryInput, Entry, Site } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { DayEditor, openHalf, otherHalfFree } from './DayEditor'

const site: Site = {
  id: 7, name: 'AK 54B', client: 'AK 54B', street: null, houseNumber: null, addressAddition: null, postalCode: null,
  city: null, nameSource: 'Auftraggeber', description: null, plannedStart: '2026-11-02', plannedEnd: null, status: 'Bauphase',
  tasks: [], labelProjectNumber: null, clientPhone: null,
}

const morning: Entry = {
  id: 1, employeeId: 3, employeeName: 'Koko', date: '2026-11-06', type: 'Baustelle', siteId: 7, siteName: 'AK 54B',
  activity: 'Fliesen', startTime: '07:30:00', endTime: '11:30:00', note: null, noteImportant: false,
}

const row = (siteId: number | null, start: string, end: string, free = false) =>
  ({ type: 'Baustelle' as const, siteId, activity: siteId ? ('Fliesen' as const) : null, free, start, end })

describe('otherHalfFree', () => {
  it('gives the other half of a day with half a day on sites and nothing else', () => {
    expect(otherHalfFree([row(7, '07:30', '11:30')])).toEqual({ start: '12:00', end: '16:00' })
    expect(otherHalfFree([row(7, '12:00', '16:00')])).toEqual({ start: '07:30', end: '11:30' })
    // A row still without a site does not count: it becomes the free half.
    expect(otherHalfFree([row(7, '07:30', '11:30'), row(null, '12:00', '16:00')])).toEqual({ start: '12:00', end: '16:00' })
  })

  it('leaves whole days, both halves taken and halves kept free already alone', () => {
    expect(otherHalfFree([row(7, '', '')])).toBeNull()
    expect(otherHalfFree([row(7, '07:30', '11:30'), row(8, '12:00', '16:00')])).toBeNull()
    expect(otherHalfFree([row(7, '07:30', '11:30'), row(null, '12:00', '16:00', true)])).toBeNull()
  })
})

describe('openHalf', () => {
  const full = (siteId: number | null, start: string, end: string, free = false) => ({ ...row(siteId, start, end, free), note: '', important: false })
  it('finds the half of the day still open for one more entry', () => {
    expect(openHalf([])).toBe('day')
    expect(openHalf([full(7, '', '')])).toBe('afternoon')
    expect(openHalf([full(7, '07:30', '11:30')])).toBe('afternoon')
    expect(openHalf([full(7, '12:00', '16:00')])).toBe('morning')
    // A half kept free does not count as taken.
    expect(openHalf([full(null, '07:30', '11:30', true), full(7, '12:00', '16:00')])).toBe('morning')
    expect(openHalf([full(7, '07:30', '11:30'), full(8, '12:00', '16:00')])).toBeNull()
  })
})

describe('DayEditor', () => {
  it('puts a new site before the afternoon taken already: into the morning', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<(entries: DayEntryInput[]) => Promise<void>>(async () => {})
    const other: Site = { ...site, id: 8, name: 'Buhl', client: 'Buhl' }
    renderWithProviders(
      <DayEditor
        employee={{ id: 3, name: 'Koko', mainActivity: 'Fliesen', additionalActivities: [] }}
        date="2026-11-06"
        entries={[{ ...morning, startTime: '12:00:00', endTime: '16:00:00' }]}
        sites={[site, other]}
        onCreateSite={async () => site}
        onClose={() => {}}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: '+ Baustelle' }))
    // The new row comes first, in the morning; the afternoon stays.
    const starts = screen.getAllByLabelText('von').filter((element) => element instanceof HTMLInputElement).map((input) => (input as HTMLInputElement).value)
    expect(starts).toEqual(['07:30', '12:00'])
    expect(screen.queryByText(/überschneiden/)).not.toBeInTheDocument()
  })

  it('drops the half clicked on as "verfügbar" when the other entry takes the whole day', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <DayEditor
        employee={{ id: 3, name: 'Koko', mainActivity: 'Fliesen', additionalActivities: [] }}
        date="2026-11-06"
        entries={[morning]}
        addHalf={{ start: '12:00', end: '16:00' }}
        sites={[site]}
        onCreateSite={async () => site}
        onClose={() => {}}
        onSave={async () => {}}
      />,
    )

    expect(screen.getByLabelText('Eintrag 2 entfernen')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Auf den ganzen Tag ausweiten' })[0])
    expect(screen.queryByLabelText('Eintrag 2 entfernen')).not.toBeInTheDocument()
  })

  it('says that the other half becomes "verfügbar" and saves it so', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<(entries: DayEntryInput[]) => Promise<void>>(async () => {})
    renderWithProviders(
      <DayEditor
        employee={{ id: 3, name: 'Koko', mainActivity: 'Fliesen', additionalActivities: [] }}
        date="2026-11-06"
        entries={[morning]}
        sites={[site]}
        onCreateSite={async () => site}
        onClose={() => {}}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(await screen.findByText(/Die andere Hälfte des Tages \(12:00–16:00\) wird auf „verfügbar“ gesetzt/)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'OK, speichern' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toEqual([
      expect.objectContaining({ siteId: 7, activity: 'Fliesen', startTime: '07:30:00', endTime: '11:30:00' }),
      expect.objectContaining({ type: 'Baustelle', siteId: null, activity: null, startTime: '12:00:00', endTime: '16:00:00' }),
    ])
  })

  it('creates a service call from the day and puts it on the day', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<(entries: DayEntryInput[]) => Promise<void>>(async () => {})
    const created: Site = { ...site, id: 9, name: 'SE: Familie Kurz', client: 'Familie Kurz', isService: true }
    const onCreateSite = vi.fn(async () => created)
    const employee = { id: 3, name: 'Koko', mainActivity: 'Fliesen' as const, additionalActivities: [] }
    const props = { employee, date: '2026-11-06', entries: [], onCreateSite, onClose: () => {}, onSave }
    const { rerender } = renderWithProviders(<DayEditor {...props} sites={[site]} />)

    await user.click(screen.getByRole('button', { name: '+ Serviceauftrag' }))
    await user.type(await screen.findByRole('textbox', { name: 'Kunde' }), 'Familie Kurz')
    await user.type(screen.getByRole('textbox', { name: 'Was ist zu tun' }), 'Spülkasten tauschen')
    await user.click(screen.getByRole('button', { name: 'Service eintragen' }))

    await waitFor(() => expect(onCreateSite).toHaveBeenCalled())
    expect(onCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ client: 'Familie Kurz', description: 'Spülkasten tauschen', isService: true, status: 'Bauphase', plannedStart: '2026-11-06' }),
    )
    // The plan gets the new site; the day is saved with it, in place of the empty row.
    rerender(<DayEditor {...props} sites={[site, created]} />)
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toEqual([expect.objectContaining({ siteId: 9, activity: 'Fliesen', startTime: null })])
  })
})
