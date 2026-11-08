import { describe, expect, it } from 'vitest'
import type { Entry, Site } from '../api/types'
import { buildSitePdf, pdfFileName } from './sitePdf'

const site: Site = {
  id: 7, name: 'Familie Kurz / Bad', client: 'Familie Kurz', street: 'Hauptstraße', houseNumber: '12', addressAddition: null,
  postalCode: '13125', city: 'Berlin', nameSource: 'Auftraggeber', description: 'Bad komplett', plannedStart: '2026-11-02',
  plannedEnd: null, status: 'Abgeschlossen', tasks: [], labelProjectNumber: null, clientPhone: '030 123 45', responsiblePlannerId: 9,
}
const entry = (id: number, employeeId: number, employeeName: string, date: string): Entry => ({
  id, employeeId, employeeName, date, type: 'Baustelle', siteId: 7, siteName: site.name, activity: null,
  startTime: null, endTime: null, note: null, noteImportant: false,
})

describe('buildSitePdf', () => {
  it('writes the summary of a site with customer, costing and every entry', async () => {
    const blob = await buildSitePdf({
      site,
      report: { siteId: 7, siteName: site.name, year: 0, totalDays: 3, totalHours: 24, employees: [], entries: [entry(1, 3, 'Koko', '2026-11-02'), entry(2, 3, 'Koko', '2026-11-03'), entry(3, 4, 'Niko', '2026-11-03')] },
      planners: [{ id: 9, name: 'Dirk Mielke', isMe: false }],
      employees: [],
      siteRates: [{ employeeId: 3, hourlyRate: 30 }],
      history: [{ from: 'Bauphase', to: 'Abgeschlossen', changedAt: '2026-11-08T10:00:00Z', changedBy: 'Marina' }],
    })
    const text = await blob.text()
    expect(text.startsWith('%PDF')).toBe(true)
    for (const part of ['Familie Kurz', 'Dirk Mielke', 'Nachkalkulation', 'Alle Eins', 'Koko', 'Niko', '480,00'])
      expect(text).toContain(part)
  })

  it('names the file after the site, without characters a file name cannot hold', () => {
    expect(pdfFileName(site)).toBe('Baustelle Familie Kurz - Bad.pdf')
  })
})
