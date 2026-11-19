import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DoneReport } from '../api/types'
import { renderWithProviders } from '../test-utils'
import { DoneReportsSheet } from './DoneReports'

const report: DoneReport = { id: 5, siteId: 7, siteName: 'Familie Kurz', changedAt: '2026-11-19T13:05:00Z', changedBy: 'Anton Planer' }

describe('DoneReportsSheet', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows who set a site done and when, and takes it off the list once seen', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    renderWithProviders(<DoneReportsSheet reports={[report]} onClose={() => {}} onChanged={onChanged} />)

    expect(screen.getByText('Familie Kurz')).toBeInTheDocument()
    expect(screen.getByText(/Auf erledigt gesetzt von Anton Planer am 19\.11\.2026 um \d\d:05/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Report als PDF speichern/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Gesehen' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/sites/7/done-report/seen', expect.objectContaining({ method: 'POST' }))
  })

  it('says when there is nothing new', () => {
    renderWithProviders(<DoneReportsSheet reports={[]} onClose={() => {}} onChanged={() => {}} />)
    expect(screen.getByText('Keine neuen erledigten Baustellen.')).toBeInTheDocument()
  })
})
