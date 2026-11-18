import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Entry } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { askedCalls, ConfirmRequests } from './ServiceConfirmations'

const entry = (id: number, date: string, confirmation: Entry['confirmation'], employeeId = 3): Entry => ({
  id, employeeId, employeeName: 'Kalle', date, type: 'Baustelle', siteId: 7, siteName: 'SE: Familie Frage', activity: 'Fliesen',
  startTime: null, endTime: null, note: null, noteImportant: false, confirmation,
})

afterEach(() => vi.unstubAllGlobals())

describe('ServiceConfirmations', () => {
  it('names a service call to confirm once, by its first day, and only his own', () => {
    const entries = [entry(2, '2026-07-15', 'Offen'), entry(1, '2026-07-14', 'Offen'), entry(3, '2026-07-14', 'Offen', 4)]
    expect(askedCalls(entries, new Map(), 'Offen', 3).map((asked) => asked.entry.id)).toEqual([1])
    expect(askedCalls(entries, new Map(), 'Abgelehnt')).toEqual([])
  })

  it('opens by itself in Mein Plan; the craftsman says yes, or no with a few words', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const onAnswered = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<ConfirmRequests asked={[{ entry: entry(1, '2026-07-14', 'Offen'), site: undefined }]} onAnswered={onAnswered} />)

    expect(await screen.findByText('Familie Frage')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Absagen' })[0])
    await user.type(screen.getByLabelText(/Warum nicht/), 'Bin beim Arzt')
    await user.click(screen.getAllByRole('button', { name: 'Absagen' }).at(-1)!)
    await waitFor(() => expect(onAnswered).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/me/confirmations/7')
    expect(JSON.parse(String(init.body))).toEqual({ accept: false, note: 'Bin beim Arzt' })
  })
})
