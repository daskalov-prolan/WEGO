import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Site } from '../api/types'
import { emptySite, toSiteInput } from '../lib/sites'
import { renderWithProviders } from '../test-utils'
import { SitePicker } from './SitePicker'

const site = (id: number, name: string, client: string | null, street: string | null): Site => ({
  ...emptySite,
  id,
  name,
  client,
  street,
  status: 'Bauphase',
  tasks: [],
})

describe('SitePicker', () => {
  it('puts the sites whose name begins with the typed letter first', async () => {
    const user = userEvent.setup()
    const sites = [site(1, 'Albers', 'Albers', 'Mühlenweg 2'), site(2, 'Mertens', 'Mertens', 'Amselweg 5'), site(3, 'Müller', 'Müller', null)]
    renderWithProviders(<SitePicker sites={sites} value={null} onChange={() => {}} onCreate={async () => sites[0]} />)
    const input = screen.getAllByLabelText(/^Baustelle/).find((element) => element.tagName === 'INPUT')!
    await user.type(input, 'm')
    const list = document.getElementById(input.getAttribute('aria-controls')!)!
    const names = within(list)
      .getAllByRole('option', { hidden: true })
      .map((option) => option.querySelector('p, .mantine-Text-root')?.textContent)
    // Mertens and Müller begin with M; Albers only lives in the Mühlenweg.
    expect(names).toEqual(['Mertens', 'Müller', 'Albers'])
  })

  it('opens the form of the chosen site straight from the day, to add or correct its details', async () => {
    const user = userEvent.setup()
    const sites = [{ ...site(1, 'Samarai', 'Samarai', 'Stockumer Straße 23'), clientPhone: null }]
    const onUpdate = vi.fn(async (_id: number, input: Parameters<typeof toSiteInput>[0] | object) => ({ ...sites[0], ...input }))
    renderWithProviders(
      <SitePicker sites={sites} value={1} onChange={() => {}} onCreate={async () => sites[0]} onUpdate={onUpdate as never} />,
    )
    await user.click(screen.getByRole('button', { name: 'Baustelle bearbeiten' }))
    const phone = await screen.findByLabelText('Telefon Kunde')
    await user.type(phone, '0162 301')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(onUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ clientPhone: '0162 301' }))
    // Saved, the day is shown again.
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()
  })
})
