import { COMPANY_ADDRESS } from './visitGroup'
import { formatDate } from './dates'
import { euros, type priceCalculation, type ProtocolData } from './offerCalc'
import {
  CALCULATION,
  calcHours,
  CHECKLIST,
  CONFIRMATION,
  formatNumber,
  isAsked,
  type Protocol,
  type Sheet,
} from './visitProtocol'

const TEAL: [number, number, number] = [15, 99, 120]
const RED: [number, number, number] = [215, 31, 39]
const LEFT = 15
const WIDTH = 180

type Pdf = InstanceType<(typeof import('jspdf'))['jsPDF']>

const GREEN: [number, number, number] = [0, 151, 72]

/** A square standing on its tip, around its centre; r is half its height. */
function diamond(pdf: Pdf, cx: number, cy: number, r: number, style: 'F' | 'FD') {
  pdf.lines([[r, -r], [r, r], [-r, r], [-r, -r]], cx - r, cy, [1, 1], style, true)
}

/**
 * The mark of WEGO as on the letters: a white square on its tip with a dark edge in front, the green one behind it
 * and the red arrow, a thin white gap between them; then WEGO in red.
 */
function logo(pdf: Pdf, x: number, cy: number) {
  const r = 5.6
  pdf.setLineWidth(0.25)
  pdf.setFillColor(...RED)
  diamond(pdf, x + 2.15 * r, cy, r, 'F')
  // The gap that cuts the red square into an arrow, and parts it from the green one.
  pdf.setFillColor(255, 255, 255)
  diamond(pdf, x + 1.05 * r, cy, r * 1.12, 'F')
  pdf.setFillColor(...GREEN)
  diamond(pdf, x + 1.05 * r, cy, r, 'F')
  pdf.setFillColor(255, 255, 255)
  pdf.setDrawColor(30)
  diamond(pdf, x, cy, r, 'FD')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(27)
  pdf.setTextColor(...RED)
  pdf.text('WEGO', x + 3.4 * r, cy + 3.6)
}

/** The head of each document: the logo of WEGO, the shop and the address. */
function letterhead(pdf: Pdf) {
  logo(pdf, LEFT + 5.6, 16)
  pdf.setFontSize(12)
  pdf.setTextColor(...TEAL)
  pdf.text('SANITÄR- & FLIESEN Fachgeschäft', LEFT + WIDTH, 16, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(90)
  pdf.text(`WEGO Sanitär- & Fliesen Fachgeschäft · ${COMPANY_ADDRESS}`, LEFT + WIDTH, 21, { align: 'right' })
  pdf.setDrawColor(...RED)
  pdf.setLineWidth(0.6)
  pdf.line(LEFT, 25, LEFT + WIDTH, 25)
  pdf.setTextColor(20)
}

/** The drawing on squared paper (its ink on white with the grid), or the photo: ready for the PDF. */
async function sheetImage(sheet: Sheet): Promise<{ data: string; width: number; height: number } | null> {
  if (!sheet.image) return null
  const img = new Image()
  img.src = sheet.image
  await img.decode()
  if (sheet.kind === 'photo') return { data: sheet.image, width: img.naturalWidth, height: img.naturalHeight }
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#dfe9ec'
  ctx.lineWidth = 1
  const step = canvas.width / 60
  for (let x = 0; x <= canvas.width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke() }
  for (let y = 0; y <= canvas.height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke() }
  ctx.drawImage(img, 0, 0)
  return { data: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height }
}

/** The signature with date and name, under the confirmation. */
function signatureBlock(pdf: Pdf, protocol: Protocol, y: number) {
  if (protocol.signature) pdf.addImage(protocol.signature, 'PNG', LEFT + 70, y, 90, 30, 'signature', 'FAST')
  pdf.setDrawColor(60)
  pdf.setLineWidth(0.3)
  pdf.line(LEFT, y + 31, LEFT + 50, y + 31)
  pdf.line(LEFT + 65, y + 31, LEFT + WIDTH, y + 31)
  pdf.setFontSize(9)
  pdf.setTextColor(80)
  pdf.text(`Datum: ${formatDate((protocol.finishedAt ?? new Date().toISOString()).slice(0, 10))}`, LEFT, y + 36)
  pdf.text(`Unterschrift Kunde${protocol.signer ? `: ${protocol.signer}` : ''}`, LEFT + 65, y + 36)
  pdf.setTextColor(20)
}

/** The customer and the visit, at the top of both documents. */
function customerBlock(pdf: Pdf, protocol: Protocol, y: number) {
  pdf.setFontSize(10)
  const rows: [string, string][] = [
    ['Kunde', protocol.client],
    ['Adresse BV', protocol.address],
    ['Telefon privat', protocol.phone],
    ['Mobil', protocol.mobile],
    ['Termin', `${formatDate(protocol.date)}${protocol.time ? `, ${protocol.time} Uhr` : ''}`],
    ['Besichtiger', protocol.visitor],
  ]
  for (const [label, value] of rows) {
    pdf.setFont('helvetica', 'bold')
    pdf.text(label, LEFT, y)
    pdf.setFont('helvetica', 'normal')
    pdf.text(value || '–', LEFT + 32, y)
    y += 5.5
  }
  return y
}

/**
 * The whole protocol: customer, check list, calculation by trade, drawings and photos, and the confirmation with
 * the signature of the customer.
 */
export async function buildProtocolPdf(protocol: Protocol): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  letterhead(pdf)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.text('Besichtigungsprotokoll (Badumbau)', LEFT, 35)
  let y = customerBlock(pdf, protocol, 44) + 2

  const table = (title: string, head: string[], body: string[][], foot?: string[]) => {
    autoTable(pdf, {
      startY: y,
      margin: { left: LEFT, right: 15 },
      head: [[{ content: title, colSpan: head.length, styles: { fillColor: TEAL, textColor: 255, fontStyle: 'bold' } }], head],
      body,
      foot: foot ? [foot] : undefined,
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 1.6 },
      headStyles: { fillColor: [200, 225, 232], textColor: [7, 42, 54] },
      footStyles: { fillColor: [214, 236, 240], textColor: [7, 42, 54], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 85 } },
    })
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5
  }

  for (const section of CHECKLIST) {
    const body = section.questions
      .filter((question) => isAsked(question, protocol.answers))
      .map((question) => {
        const value = protocol.answers[question.id]?.trim()
        return [question.label, value ? `${value}${question.unit ? ` ${question.unit}` : ''}` : '–']
      })
    if (section.hint) body.push(['Hinweis', section.hint])
    table(section.title, ['Frage', 'Antwort'], body)
  }

  pdf.addPage()
  letterhead(pdf)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.text('Kalkulation Umbauarbeiten', LEFT, 35)
  y = 41
  for (const group of CALCULATION) {
    const body = group.items.map((item) => {
      const value = protocol.calc[item.id] ?? {}
      const detail = [value.choice, item.qm && value.qm ? `${value.qm} qm` : ''].filter(Boolean).join(' · ')
      return [item.label, item.hours ? (value.hours ? `${value.hours} Std.` : '–') : detail || '–', item.material ? value.material || '–' : '']
    })
    table(group.title, ['Position', 'Aufwand / Angabe', 'Material'], body, ['Summe', `${formatNumber(calcHours(protocol.calc, group))} Std.`, ''])
  }
  const total = calcHours(protocol.calc)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text(`Zusammen: ${formatNumber(total)} Std. (ca. ${formatNumber(total / 8)} Arbeitstage à 8 Std.)`, LEFT, y + 2)

  for (const sheet of protocol.sheets) {
    const image = await sheetImage(sheet)
    if (!image) continue
    pdf.addPage()
    letterhead(pdf)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(13)
    pdf.text(sheet.name, LEFT, 35)
    const scale = Math.min(WIDTH / image.width, 230 / image.height)
    pdf.addImage(image.data, 'JPEG', LEFT, 40, image.width * scale, image.height * scale, sheet.id, 'FAST')
  }

  pdf.addPage()
  confirmationPage(pdf, protocol, autoTable)
  return pdf.output('blob')
}

/** The page the customer signed: the visit and its price, the confirmation, the signature. */
function confirmationPage(pdf: Pdf, protocol: Protocol, autoTable: (typeof import('jspdf-autotable'))['autoTable']) {
  letterhead(pdf)
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  const address = [protocol.client, ...protocol.address.split(', ')].filter(Boolean)
  address.forEach((line, i) => pdf.text(line, LEFT, 38 + i * 5))
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.text(CONFIRMATION.title, LEFT, 70)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(`Datum: ${formatDate(protocol.date)}`, LEFT, 77)
  pdf.text(`Besichtiger: ${protocol.visitor}`, LEFT + 60, 77)
  autoTable(pdf, {
    startY: 83,
    margin: { left: LEFT, right: 15 },
    head: [['Pos.', 'Bezeichnung', 'Preis']],
    body: [['1', CONFIRMATION.text, CONFIRMATION.price]],
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2 },
    headStyles: { fontStyle: 'bold', lineWidth: { bottom: 0.4 }, lineColor: 20 },
    columnStyles: { 0: { cellWidth: 12 }, 2: { cellWidth: 28, halign: 'right', fontStyle: 'bold' } },
  })
  const y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  pdf.setDrawColor(20)
  pdf.line(LEFT, y - 3, LEFT + WIDTH, y - 3)
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'bold')
  pdf.text(pdf.splitTextToSize(CONFIRMATION.confirm, WIDTH), LEFT, y + 6)
  pdf.setFont('helvetica', 'normal')
  pdf.text(pdf.splitTextToSize(CONFIRMATION.credit, WIDTH), LEFT, y + 14)
  signatureBlock(pdf, protocol, y + 22)
}

/** The confirmation alone: the customer gets it later with the invoice. */
export async function buildConfirmationPdf(protocol: Protocol): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  confirmationPage(pdf, protocol, autoTable)
  return pdf.output('blob')
}

/** The calculation of a visit priced with the rates of the offers (for the planners, as a basis of the offer). */
export async function buildPricedCalcPdf(data: ProtocolData, priced: ReturnType<typeof priceCalculation>): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  letterhead(pdf)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.text('Kalkulation mit Stundensätzen (netto)', LEFT, 35)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(`${data.client} · ${data.address}`, LEFT, 42)
  pdf.text(`Besichtigung am ${formatDate(data.date)} durch ${data.visitor} · nur für die Planer`, LEFT, 47)
  let y = 53
  const after = () => (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  for (const group of priced.groups) {
    autoTable(pdf, {
      startY: y,
      margin: { left: LEFT, right: 15 },
      head: [
        [{ content: group.title, colSpan: 5, styles: { fillColor: TEAL, textColor: 255, fontStyle: 'bold' } }],
        ['Position', 'Std.', 'Satz', 'Lohn', 'Material'],
      ],
      body: group.lines.map((line) => [
        line.label,
        line.hours ? formatNumber(line.hours) : '',
        line.rate === null ? (line.hours ? 'kein Satz' : '') : euros(line.rate),
        line.hours ? euros(line.amount) : '',
        line.material,
      ]),
      foot: [['Summe', formatNumber(group.hours), '', euros(group.labour), group.material ? euros(group.material) : '']],
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 1.6 },
      headStyles: { fillColor: [200, 225, 232], textColor: [7, 42, 54] },
      footStyles: { fillColor: [214, 236, 240], textColor: [7, 42, 54], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 72 }, 1: { halign: 'right', cellWidth: 14 }, 2: { halign: 'right', cellWidth: 26 }, 3: { halign: 'right', cellWidth: 28 } },
    })
    y = after() + 5
  }
  autoTable(pdf, {
    startY: y,
    margin: { left: LEFT + 90, right: 15 },
    body: [
      ['Stunden', formatNumber(priced.hours)],
      ['Lohn netto', euros(priced.labour)],
      ['Material netto (soweit Beträge)', euros(priced.material)],
      ['Zusammen netto', euros(priced.net)],
    ],
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 1.6 },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
  })
  if (priced.missing.length > 0) {
    pdf.setFontSize(9)
    pdf.setTextColor(...RED)
    pdf.text(pdf.splitTextToSize(`Ohne Stundensatz (nicht in der Summe): ${priced.missing.join(', ')}`, WIDTH), LEFT, after() + 6)
  }
  return pdf.output('blob')
}
