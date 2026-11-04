import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { emptySite } from '../lib/sites'
import { renderWithProviders } from '../test-utils'
import { SiteForm } from './SiteForm'

// Text fields only: "Auftraggeber" and "Straße" are also the labels of the radio buttons.
const input = (label: RegExp) =>
  screen.getAllByLabelText(label).find((element) => element.tagName === 'INPUT' && element.getAttribute('type') !== 'radio')!

// A site needs its planner in charge before it is saved.
const withPlanner = { ...emptySite, responsiblePlannerId: 7 }

describe('SiteForm', () => {
  it('takes what is typed and shows the name the plan will use', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    renderWithProviders(<SiteForm title="Neue Baustelle" initial={emptySite} onClose={() => {}} onSave={onSave} />)

    await screen.findAllByLabelText(/^Auftraggeber/)
    await user.type(input(/^Auftraggeber/), 'Hausverwaltung Nord')
    // Not without the planner in charge.
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(screen.getByText('Bitte den zuständigen Planer wählen.')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
    cleanup()
    renderWithProviders(<SiteForm title="Neue Baustelle" initial={withPlanner} onClose={() => {}} onSave={onSave} />)
    await screen.findAllByLabelText(/^Auftraggeber/)
    await user.type(input(/^Auftraggeber/), 'Hausverwaltung Nord')
    await user.type(input(/^Straße und Hausnummer/), 'Hauptstraße 12')
    await user.type(input(/^Telefon Kunde/), '030 1234567')
    expect(screen.getByText('Hausverwaltung Nord', { selector: 'strong' })).toBeInTheDocument()
    // Neither the number in Label nor a planned end; the address addition hints at the lift.
    expect(screen.queryByLabelText(/Projektnummer/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Geplantes Ende/)).not.toBeInTheDocument()
    expect(screen.queryByText('Kunde oder Hausverwaltung')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('z. B. Hinterhaus, 3. OG links, mit oder ohne Aufzug')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Straße' }))
    expect(screen.getByText('Hauptstraße 12', { selector: 'strong' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        client: 'Hausverwaltung Nord',
        street: 'Hauptstraße 12',
        houseNumber: null,
        clientPhone: '030 1234567',
        nameSource: 'Strasse',
        status: 'Angebot',
      }),
    )
  })
})

describe('SiteForm with a site kept before', () => {
  it('joins a separate house number into the street', async () => {
    const onSave = vi.fn(async () => {})
    renderWithProviders(
      <SiteForm title="Baustelle bearbeiten" initial={{ ...withPlanner, client: 'Meier', street: 'Musterweg', houseNumber: '3' }} onClose={() => {}} onSave={onSave} />,
    )
    expect(await screen.findByDisplayValue('Musterweg 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ street: 'Musterweg 3', houseNumber: null }))
  })
})

describe('SiteForm without a client', () => {
  it('names the site by its street, so a first visit with only an address can be saved', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    renderWithProviders(<SiteForm title="Neue Baustelle" initial={withPlanner} onClose={() => {}} onSave={onSave} />)
    await screen.findAllByLabelText(/^Auftraggeber/)
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
    await user.type(input(/^Straße und Hausnummer/), 'Lindenweg 4')
    expect(screen.getByText('Lindenweg 4', { selector: 'strong' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ street: 'Lindenweg 4', nameSource: 'Strasse' }))
  })

  it('fills in the town with its borough from the postal code, but keeps a town typed in by hand', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith('/api/postal-codes/13507')
        ? new Response(JSON.stringify({ postalCode: '13507', city: 'Berlin-Reinickendorf' }), { status: 200 })
        : new Response('[]', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      renderWithProviders(<SiteForm title="Neue Baustelle" initial={emptySite} onClose={() => {}} onSave={async () => {}} />)
      await user.type(input(/^Straße und Hausnummer/), 'Stockumer Straße 23')
      await user.type(input(/^PLZ/), '13507')
      await vi.waitFor(() => expect(input(/^Ort/)).toHaveValue('Berlin-Reinickendorf'))
      expect(fetchMock).toHaveBeenCalledWith('/api/postal-codes/13507?street=Stockumer%20Stra%C3%9Fe%2023', expect.anything())

      await user.clear(input(/^Ort/))
      await user.type(input(/^Ort/), 'Tegel')
      await user.clear(input(/^PLZ/))
      await user.type(input(/^PLZ/), '13507')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(input(/^Ort/)).toHaveValue('Tegel')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
