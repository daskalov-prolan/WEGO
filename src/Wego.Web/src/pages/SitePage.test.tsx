import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Site } from '../api/types'
import { emptySite } from '../lib/sites'
import { renderWithProviders } from '../test-utils'
import { SitePage } from './SitePage'

const site: Site = {
  ...emptySite,
  id: 7,
  name: 'Familie Probe',
  client: 'Familie Probe',
  clientPhone: '030 55 66',
  street: 'Lindenweg 4',
  postalCode: '13125',
  city: 'Berlin',
  plannedStart: '2026-11-16',
  status: 'Bauphase',
  tasks: [],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/sites') return new Response(JSON.stringify([site]), { status: 200 })
    if (url.startsWith('/api/reports/sites/7'))
      return new Response(
        JSON.stringify({ siteId: 7, siteName: site.name, year: 2026, totalDays: 0, totalHours: 0, employees: [], entries: [] }),
        { status: 200 },
      )
    if (url === '/api/sites/7' && init?.method === 'DELETE')
      return new Response(JSON.stringify({ message: '„Familie Probe“ hat 3 Einträge im Plan.', entries: 3 }), { status: 409 })
    if (url === '/api/sites/7?withEntries=true') return new Response(null, { status: 204 })
    if (url.startsWith('/api/plan'))
      return new Response(JSON.stringify({ year: 2026, employees: [], planners: [], sites: [site], entries: [], schoolHolidays: [] }), { status: 200 })
    return new Response('[]', { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('SitePage', () => {
  it('sums up customer, address and planning', async () => {
    renderWithProviders(<SitePage year={2026} siteId={7} />)
    expect(await screen.findByText('Telefon Kunde')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Anrufen: 030 55 66' })).toHaveAttribute('href', 'tel:0305566')
    expect(screen.getByText('Geplanter Start').nextElementSibling).toHaveTextContent(/16.11./)
    expect(screen.queryByText(/Label/)).not.toBeInTheDocument()
  })

  it('asks again before deleting a site with entries, and deletes them with it', async () => {
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const user = userEvent.setup()
    renderWithProviders(<SitePage year={2026} siteId={7} />)
    await screen.findByText('Telefon Kunde')
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Baustelle löschen …' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/sites/7?withEntries=true')).toBe(true))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm).toHaveBeenLastCalledWith('„Familie Probe“ hat 3 Einträge im Plan. Diese Einträge werden mit gelöscht. Wirklich löschen?')
  })
})

describe('SitePage costing', () => {
  const work = (id: number, date: string, start: string | null, end: string | null) => ({
    id, employeeId: 2, employeeName: 'Bernd', date, type: 'Baustelle', siteId: 7, siteName: site.name, activity: 'Fliesen',
    startTime: start, endTime: end, note: null, noteImportant: false,
  })

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/sites') return new Response(JSON.stringify([site]), { status: 200 })
      // The whole time of the site, over two years: a full day (8 hours) and a half one (4 hours).
      if (url === '/api/reports/sites/7')
        return new Response(
          JSON.stringify({ siteId: 7, siteName: site.name, year: 0, totalDays: 2, totalHours: 4, employees: [],
            entries: [work(1, '2026-12-30', null, null), work(2, '2027-01-04', '12:00:00', '16:00:00')] }),
          { status: 200 },
        )
      if (url === '/api/employees') return new Response(JSON.stringify([{ id: 2, name: 'Bernd', hourlyRate: 40 }]), { status: 200 })
      if (url.startsWith('/api/plan'))
        return new Response(JSON.stringify({ year: 2026, employees: [], planners: [], sites: [site], entries: [], schoolHolidays: [] }), { status: 200 })
      return new Response('[]', { status: 200 })
    })
  })

  it('counts the working days of the whole site and, for Planer G, the labour costs', async () => {
    renderWithProviders(<SitePage year={2026} siteId={7} canSeeEmployees />)
    const costing = await screen.findByRole('region', { name: 'Nachkalkulation' })
    // 12 hours at 40 €: the row of Bernd and the total.
    expect(await within(costing).findAllByText(/480,00/)).toHaveLength(2)
    expect(within(costing).getByLabelText('Stundensatz Bernd')).toHaveValue('40 €/Std.')
    expect(screen.getByText('Arbeitstage gesamt').previousElementSibling).toHaveTextContent('2')
  })

  it('changes the rate of a craftsman for this site only and goes back to the usual one', async () => {
    const user = userEvent.setup()
    let siteRates: { employeeId: number; hourlyRate: number }[] = []
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/sites/7/hourly-rates') return new Response(JSON.stringify(siteRates), { status: 200 })
      if (url === '/api/sites/7/hourly-rates/2') {
        const rate = JSON.parse(String(init?.body)).hourlyRate
        siteRates = rate === null ? [] : [{ employeeId: 2, hourlyRate: rate }]
        return new Response(JSON.stringify(siteRates), { status: 200 })
      }
      return base(url, init)
    })
    renderWithProviders(<SitePage year={2026} siteId={7} canSeeEmployees />)
    const costing = await screen.findByRole('region', { name: 'Nachkalkulation' })
    const input = await within(costing).findByLabelText('Stundensatz Bernd')

    await user.clear(input)
    await user.type(input, '50')
    await user.tab()
    // 12 hours at 50 € on this site; the usual 40 € stays with Bernd.
    expect(await within(costing).findAllByText(/600,00/)).toHaveLength(2)
    expect(within(costing).getByText(/nur hier · üblich 40,00/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/employees/2')).toBe(false)

    await user.click(within(costing).getByRole('button', { name: 'zurücksetzen' }))
    expect(await within(costing).findAllByText(/480,00/)).toHaveLength(2)
    expect(siteRates).toEqual([])
  })

  it('shows the working days to Planer A, but not the costing', async () => {
    renderWithProviders(<SitePage year={2026} siteId={7} />)
    expect(await screen.findByText('Arbeitstage gesamt')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Nachkalkulation' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/employees')).toBe(false)
  })
})
