import type { Planner, Site, SiteHourlyRate, SiteReport, StatusChange, Employee } from '../api/types'
import { ACTIVITIES, activityLabel, SITE_STATUSES } from './activities'
import { formatDate, formatHours, formatTimeRange } from './dates'
import { euro, rowsOf } from './siteHours'
import { formatAddress } from './sites'

/** Everything the page of a site shows to Planer G, without its calendar. */
export interface SiteSummaryData {
  site: Site
  report: SiteReport
  planners: Planner[]
  employees: Employee[]
  siteRates: SiteHourlyRate[]
  history: StatusChange[]
}

const TEAL: [number, number, number] = [16, 98, 117]
const RED: [number, number, number] = [218, 33, 40]

/** A file name for the summary: the name of the site, without what a file name cannot hold. */
export const pdfFileName = (site: Site) => `Baustelle ${site.name.replace(/[\\/:*?"<>|]+/g, '-').trim()}.pdf`

/**
 * The summary of a site as a PDF, in the order of its page: customer, address and planning, the status with its
 * history, the working days, the costing afterwards, the days per activity and every entry.
 */
export async function buildSitePdf({ site, report, planners, employees, siteRates, history }: SiteSummaryData): Promise<Blob> {
  // Only loaded when a summary is made: the plan does not carry it.
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const left = 15
  const width = 180
  let y = 18

  const lastY = () => (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  const room = (needed: number) => {
    if (y + needed > 280) {
      pdf.addPage()
      y = 18
    }
  }
  const heading = (text: string) => {
    room(16)
    y += 4
    pdf.setFillColor(...TEAL)
    pdf.rect(left, y - 4.5, 1.2, 6, 'F')
    pdf.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...TEAL)
    pdf.text(text, left + 3.5, y)
    pdf.setTextColor(0, 0, 0)
    y += 6
  }
  const fact = (label: string, value: string) => {
    room(7)
    pdf.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110, 110, 110)
    pdf.text(label, left, y)
    pdf.setFontSize(10).setTextColor(0, 0, 0)
    const lines = pdf.splitTextToSize(value || '–', width - 40)
    pdf.text(lines, left + 40, y)
    y += 5 * lines.length + 1
  }
  const table = (head: string[], body: string[][], foot?: string[], right: number[] = []) => {
    autoTable(pdf, {
      startY: y,
      margin: { left, right: 15 },
      head: [head],
      body,
      foot: foot ? [foot] : undefined,
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 1.8 },
      headStyles: { fillColor: TEAL, textColor: 255 },
      footStyles: { fillColor: [214, 236, 240], textColor: [7, 42, 54], fontStyle: 'bold' },
      columnStyles: Object.fromEntries(right.map((column) => [column, { halign: 'right' }])),
      didParseCell: (data) => {
        if (right.includes(data.column.index)) data.cell.styles.halign = 'right'
      },
    })
    y = lastY() + 6
  }

  // The head: WEGO in its colours, the name of the site and when the summary was made.
  pdf.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...TEAL)
  pdf.text('WEGO Badcenter · Baustellenzusammenfassung', left, y)
  y += 9
  pdf.setFontSize(18).setTextColor(0, 0, 0)
  pdf.text(pdf.splitTextToSize(site.name, width), left, y)
  y += 3
  pdf.setFillColor(...RED)
  pdf.rect(left, y, 14, 1.2, 'F')
  y += 7
  pdf.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110, 110, 110)
  const status = SITE_STATUSES.find((candidate) => candidate.value === site.status)?.label ?? site.status
  pdf.text(`Status: ${status} · erstellt am ${new Date().toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}`, left, y)
  pdf.setTextColor(0, 0, 0)
  y += 6

  heading('Kunde')
  fact('Auftraggeber', site.client ?? '')
  fact('Telefon', site.clientPhone ?? '')
  heading('Adresse')
  fact('Adresse', formatAddress(site) ?? '')
  heading('Planung')
  fact('Baubeginn', site.plannedStart ? formatDate(site.plannedStart) : '')
  fact('Bearbeiter', planners.find((planner) => planner.id === site.responsiblePlannerId)?.name ?? '')
  if (site.isService) fact('Art', 'Serviceeinsatz')
  if (site.description) fact('Beschreibung', site.description)

  if (history.length > 0) {
    heading('Verlauf des Status')
    table(
      ['Wann', 'Änderung', 'Von'],
      history.map((change) => [
        new Date(change.changedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }),
        // The standard font of the PDF has no arrow.
        change.from ? `von ${change.from} zu ${change.to}` : `angelegt als ${change.to}`,
        change.changedBy ?? '',
      ]),
    )
  }

  // Working days and the costing afterwards, as on the page.
  const rows = rowsOf(report.entries)
  const days = rows.reduce((sum, row) => sum + row.days, 0)
  const hours = rows.reduce((sum, row) => sum + row.hours, 0)
  heading('Arbeitstage')
  fact('Gesamt', `${days} Arbeitstage · ${rows.length} Handwerker · ${formatHours(hours)} Stunden`)
  const rateOf = (id: number) =>
    siteRates.find((rate) => rate.employeeId === id)?.hourlyRate ?? employees.find((employee) => employee.id === id)?.hourlyRate ?? null
  const costs = rows.reduce((sum, row) => sum + row.hours * (rateOf(row.id) ?? 0), 0)
  heading('Nachkalkulation')
  table(
    ['Handwerker', 'Arbeitstage', 'Stunden', 'Stundensatz', 'Lohnkosten'],
    rows.map((row) => {
      const rate = rateOf(row.id)
      return [row.name, String(row.days), formatHours(row.hours), rate === null ? '–' : `${euro(rate)}/Std.`, rate === null ? '–' : euro(row.hours * rate)]
    }),
    ['Lohnkosten gesamt', String(days), formatHours(hours), '', euro(costs)],
    [1, 2, 3, 4],
  )
  const missing = rows.filter((row) => rateOf(row.id) === null)
  if (missing.length > 0) fact('Ohne Stundensatz', missing.map((row) => row.name).join(', '))

  const byActivity = ACTIVITIES.map((activity) => {
    const of = report.entries.filter((entry) => entry.activity === activity.value)
    return { label: activity.label, days: of.length, last: of.at(-1)?.date }
  }).filter((row) => row.days > 0)
  if (byActivity.length > 0) {
    heading('Nach Tätigkeit')
    table(['Tätigkeit', 'Einsatztage', 'Zuletzt'], byActivity.map((row) => [row.label, String(row.days), row.last ? formatDate(row.last) : '']), undefined, [1])
  }

  heading('Alle Einsätze')
  table(
    ['Tag', 'Mitarbeiter', 'Tätigkeit', 'Zeitfenster'],
    report.entries.map((entry) => [formatDate(entry.date), entry.employeeName, activityLabel(entry.activity) ?? '', formatTimeRange(entry) || 'ganztägig']),
  )

  // Page numbers at the foot.
  const pages = pdf.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page)
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130, 130, 130)
    pdf.text(`${site.name} · Seite ${page} von ${pages}`, left, 290)
  }
  return pdf.output('blob')
}

/** Where the summary goes: a file chosen in the dialog of the browser, or a download where there is none. */
export type PdfTarget = { write: (blob: Blob) => Promise<void> }

interface SavePicker {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>
}

/**
 * Asks where the PDF is saved (Edge and Chrome show their dialog for it). null: the question was cancelled.
 * Without that dialog (other browsers, phones) the file is downloaded; the browser asks there where it goes.
 */
export async function askPdfTarget(fileName: string): Promise<PdfTarget | null> {
  const picker = (window as unknown as SavePicker).showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker({ suggestedName: fileName, types: [{ description: 'PDF-Datei', accept: { 'application/pdf': ['.pdf'] } }] })
      return {
        write: async (blob) => {
          const file = await handle.createWritable()
          await file.write(blob)
          await file.close()
        },
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null
      // Not allowed here (e.g. no click just before): the download instead.
    }
  }
  return {
    write: async (blob) => {
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = fileName
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 10000)
    },
  }
}
