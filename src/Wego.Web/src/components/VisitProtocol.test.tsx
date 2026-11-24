import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Entry, Site } from '../api/types'
import { emptySite } from '../lib/sites'
import { loadDraft } from '../lib/tabletStore'
import { renderWithProviders } from '../test-utils'
import { VisitProtocol } from './VisitProtocol'

const site: Site = {
  ...emptySite, id: 42, name: 'Muster', client: 'Muster', salutation: 'Familie', street: 'Musterweg', houseNumber: '1',
  postalCode: '13125', city: 'Berlin', clientPhone: '0170 111', clientPhone2: '030 222', status: 'Angebot', tasks: [],
} as Site
const visit: Entry = {
  id: 9, employeeId: 6, employeeName: 'Stefan Buder', date: '2026-11-26', type: 'Baustelle', siteId: 42, siteName: 'Muster',
  activity: 'Besichtigung', startTime: '10:30:00', endTime: '11:30:00', note: null, noteImportant: false,
}

describe('VisitProtocol', () => {
  it('starts with what the plan knows, keeps every answer on the tablet and adds up the calculation', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VisitProtocol site={site} entry={visit} visitor="Stefan Buder" onClose={() => {}} />)

    // The customer from the plan: the second number is the landline, the first the mobile.
    expect(await screen.findByRole('textbox', { name: 'Kunde' })).toHaveValue('Familie Muster')
    expect(screen.getByRole('textbox', { name: 'Adresse BV' })).toHaveValue('Musterweg 1, 13125 Berlin')
    expect(screen.getByRole('textbox', { name: 'Telefon privat' })).toHaveValue('030 222')
    expect(screen.getByRole('textbox', { name: 'Mobil' })).toHaveValue('0170 111')

    // A question that depends on another shows after its answer.
    expect(screen.queryByRole('textbox', { name: 'Anzahl Kernbohrungen' })).not.toBeInTheDocument()
    const kernbohrung = screen.getByText('Kernbohrung notwendig?').closest('.protocol-question') as HTMLElement
    await user.click(kernbohrung.querySelector('input[value="ja"]')!)
    await user.type(await screen.findByRole('textbox', { name: 'Anzahl Kernbohrungen' }), '2')
    await user.type(screen.getByRole('textbox', { name: 'Entfernung Aufstellort Bauschuttcontainer zum Haus' }), '15')

    await user.click(screen.getByRole('tab', { name: '2 Kalkulation' }))
    await user.type(screen.getByRole('textbox', { name: 'Demontage alte Sanitärobjekte Stunden' }), '3')
    await user.type(screen.getByRole('textbox', { name: 'Wandfliesen abschlagen Stunden' }), '2,5')
    expect(screen.getByText('5,5 Std. · ca. 0,7 Arbeitstage')).toBeInTheDocument()

    await waitFor(async () => {
      const draft = await loadDraft('42|2026-11-26')
      expect(draft?.answers).toMatchObject({ kernbohrung: 'ja', kernbohrungAnzahl: '2', container: '15' })
      expect(draft?.calc.demWandfliesen?.hours).toBe('2,5')
    })
  })

  it('asks for the signature and the name before it is finished, with the gross price only', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VisitProtocol site={{ ...site, id: 43 }} entry={{ ...visit, siteId: 43 }} visitor="Stefan Buder" onClose={() => {}} />)
    await user.click(await screen.findByRole('tab', { name: '4 Unterschrift' }))
    expect(screen.getByText('89,00 EUR')).toBeInTheDocument()
    expect(screen.queryByText(/74,79/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Besichtigung abschließen' }))
    expect(await screen.findByText('Bitte den Kunden unterschreiben lassen.')).toBeInTheDocument()
  })
})
