import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { User } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { AppShell } from './AppShell'

const user = (role: User['role'], seesOffers: boolean): User => ({
  id: 1, name: 'Test', userName: 'test', role, showInPlan: true, mustChangePassword: false, seesOffers,
})

const menu = () => within(screen.getByRole('navigation')).getAllByRole('link').map((link) => link.getAttribute('aria-label'))

describe('AppShell', () => {
  it('shows the plan per phase next to each other and the records on the right', () => {
    renderWithProviders(
      <AppShell user={user('PlanerG', true)} page="angebotsphase" onLogout={() => {}}>
        <p>Inhalt</p>
      </AppShell>,
    )
    expect(menu()).toEqual(['Mein Plan', 'Angebotsphase', 'Bauphase', 'Baustellen', 'Mitarbeiter', 'Verwaltung', 'Mein Bereich'])
    expect(screen.getByRole('link', { name: 'Angebotsphase' })).toHaveAttribute('aria-current', 'page')
    // The records start the group on the right.
    expect(screen.getByRole('link', { name: 'Baustellen' })).toHaveClass('nav-right')
    expect(screen.getByRole('link', { name: 'Mitarbeiter' })).not.toHaveClass('nav-right')
  })

  it('on a phone keeps the plans in the bar and puts the records under Mehr when there are many', async () => {
    const wide = window.matchMedia
    window.matchMedia = ((query: string) => ({ ...wide(query), matches: query.includes('max-width: 720px') })) as typeof window.matchMedia
    try {
      renderWithProviders(
        <AppShell user={user('PlanerG', true)} page="mitarbeiter" onLogout={() => {}}>
          <p>Inhalt</p>
        </AppShell>,
      )
      expect(menu()).toEqual(['Mein Plan', 'Angebotsphase', 'Bauphase'])
      const more = within(screen.getByRole('navigation')).getByRole('button', { name: 'Mehr' })
      // The page open is among them: Mehr is marked.
      expect(more).toHaveAttribute('aria-current', 'page')
      await userEvent.click(more)
      expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Baustellen', 'Mitarbeiter', 'Verwaltung', 'Mein Bereich'])
    } finally {
      window.matchMedia = wide
    }
  })

  it('offers a craftsman no offer phase, but the list of employees', () => {
    renderWithProviders(
      <AppShell user={user('Handwerker', false)} page="bauphase" onLogout={() => {}}>
        <p>Inhalt</p>
      </AppShell>,
    )
    expect(menu()).toEqual(['Mein Plan', 'Bauphase', 'Mitarbeiter', 'Mein Bereich'])
  })
})
