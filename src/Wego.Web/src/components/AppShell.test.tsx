import { screen, within } from '@testing-library/react'
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
      <AppShell user={user('PlanerG', true)} page="angebotsphase" year={2026} onYearChange={() => {}} onLogout={() => {}}>
        <p>Inhalt</p>
      </AppShell>,
    )
    expect(menu()).toEqual(['Mein Plan', 'Planung Angebotsphase', 'Bauphase', 'Baustellen', 'Mitarbeiter', 'Verwaltung', 'Mein Bereich'])
    expect(screen.getByRole('link', { name: 'Planung Angebotsphase' })).toHaveAttribute('aria-current', 'page')
    // The records start the group on the right.
    expect(screen.getByRole('link', { name: 'Baustellen' })).toHaveClass('nav-right')
    expect(screen.getByRole('link', { name: 'Mitarbeiter' })).not.toHaveClass('nav-right')
  })

  it('offers a craftsman no offer phase, but the list of employees', () => {
    renderWithProviders(
      <AppShell user={user('Handwerker', false)} page="bauphase" year={2026} onYearChange={() => {}} onLogout={() => {}}>
        <p>Inhalt</p>
      </AppShell>,
    )
    expect(menu()).toEqual(['Mein Plan', 'Bauphase', 'Mitarbeiter', 'Mein Bereich'])
  })
})
