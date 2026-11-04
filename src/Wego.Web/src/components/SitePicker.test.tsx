import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Site } from '../api/types'
import { emptySite } from '../lib/sites'
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

  it('goes from the day straight to the page of the chosen site, to add or correct its details', async () => {
    const user = userEvent.setup()
    const sites = [{ ...site(1, 'Samarai', 'Samarai', 'Stockumer Straße 23'), clientPhone: null }]
    const onGoToSite = vi.fn()
    renderWithProviders(
      <SitePicker sites={sites} value={1} onChange={() => {}} onCreate={async () => sites[0]} onGoToSite={onGoToSite} />,
    )
    await user.click(screen.getByRole('button', { name: 'Zur Baustelle' }))
    expect(onGoToSite).toHaveBeenCalledWith(1)
  })
})
