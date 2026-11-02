import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityDef } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { ActivitiesAdmin } from './ActivitiesAdmin'

const activities: ActivityDef[] = [
  { key: 'Besichtigung', label: 'Besichtigung', phase: 'Angebot', sortOrder: 1, color: '#5fd6cf' },
  { key: 'Objektauswahl', label: 'Objektauswahl', phase: 'Angebot', sortOrder: 2, color: '#a1887f' },
  { key: 'Abriss', label: 'Abriss / Baubeginn', phase: 'Bauphase', sortOrder: 3, color: '#f46a6a' },
  { key: 'Sanitaer', label: 'Sanitär', phase: 'Bauphase', sortOrder: 4, color: '#7db4f2' },
]

let fetchMock: ReturnType<typeof vi.fn>
const onChanged = vi.fn(async () => {})

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/activities/order') {
      const keys = JSON.parse(String(init?.body)) as string[]
      return new Response(JSON.stringify(keys.map((key, i) => ({ ...activities.find((a) => a.key === key)!, sortOrder: i + 1 }))))
    }
    if (url.endsWith('/usage')) return new Response(JSON.stringify({ entries: 3, employees: 1, sites: 0 }))
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    if (init?.method === 'POST') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), key: 'Elektro', sortOrder: 5 }), { status: 201 })
    return new Response(JSON.stringify(activities))
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const body = (url: string, method: string) => {
  const call = fetchMock.mock.calls.find(([u, init]) => u === url && init?.method === method)
  return call && JSON.parse(String(call[1].body))
}

describe('ActivitiesAdmin', () => {
  it('lists the activities per phase and moves one within its phase', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ActivitiesAdmin onChanged={onChanged} />)

    const offer = (await screen.findByRole('heading', { name: 'Angebotsphase' })).closest('div')!
    expect(within(offer).getAllByRole('row').map((row) => row.querySelector('td:nth-child(2)')?.textContent)).toEqual([
      'Besichtigung',
      'Objektauswahl',
    ])
    expect(screen.getByRole('button', { name: 'Besichtigung nach oben' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Sanitär nach oben' }))
    await waitFor(() => expect(body('/api/activities/order', 'PUT')).toEqual(['Besichtigung', 'Objektauswahl', 'Sanitaer', 'Abriss']))
    expect(onChanged).toHaveBeenCalled()
  })

  it('creates an activity with phase and colour, and deletes one after naming where it is used', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderWithProviders(<ActivitiesAdmin onChanged={onChanged} />)
    await screen.findByText('Sanitär')

    await user.click(screen.getByRole('button', { name: '+ Tätigkeit anlegen' }))
    await user.type(await screen.findByLabelText(/^Name/), 'Elektro')
    await user.click(screen.getByRole('radio', { name: 'Angebotsphase' }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(body('/api/activities', 'POST')).toEqual({ label: 'Elektro', phase: 'Angebot', color: '#607d8b' }))

    const row = screen.getByText('Sanitär').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Löschen' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/activities/Sanitaer' && init?.method === 'DELETE')).toBe(true))
    expect(confirm.mock.calls[0][0]).toContain('3 Einträgen im Plan')
  })
})
