import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { emptySite } from '../lib/sites'
import { renderWithProviders } from '../test-utils'
import { SiteForm } from './SiteForm'

// Text fields only: "Auftraggeber" and "Straße" are also the labels of the radio buttons.
const input = (label: RegExp) =>
  screen.getAllByLabelText(label).find((element) => element.tagName === 'INPUT' && element.getAttribute('type') !== 'radio')!

describe('SiteForm', () => {
  it('takes what is typed and shows the name the plan will use', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    renderWithProviders(<SiteForm title="Neue Baustelle" initial={emptySite} onClose={() => {}} onSave={onSave} />)

    await screen.findAllByLabelText(/^Auftraggeber/)
    await user.type(input(/^Auftraggeber/), 'Hausverwaltung Nord')
    await user.type(input(/^Straße/), 'Hauptstraße')
    await user.type(input(/^Hausnummer/), '12')
    expect(screen.getByText('Hausverwaltung Nord', { selector: 'strong' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Straße' }))
    expect(screen.getByText('Hauptstraße 12', { selector: 'strong' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        client: 'Hausverwaltung Nord',
        street: 'Hauptstraße',
        houseNumber: '12',
        nameSource: 'Strasse',
        status: 'Angebot',
      }),
    )
  })
})
