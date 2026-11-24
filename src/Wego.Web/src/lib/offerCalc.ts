import type { OfferRate } from '../api/types'
import { CALCULATION, toNumber, type CalcValue, type Protocol } from './visitProtocol'

/** What a protocol sends along with its PDF: the customer, the answers and the calculation, no drawings, no signature. */
export interface ProtocolData {
  siteName: string
  client: string
  address: string
  date: string
  visitor: string
  answers: Record<string, string>
  calc: Record<string, CalcValue>
}

export const protocolData = (protocol: Protocol): string =>
  JSON.stringify({
    siteName: protocol.siteName,
    client: protocol.client,
    address: protocol.address,
    date: protocol.date,
    visitor: protocol.visitor,
    answers: protocol.answers,
    calc: protocol.calc,
  } satisfies ProtocolData)

/** "180 €", "ca. 95,50" -> 180, 95.5; text without a number -> null. */
export function materialAmount(text: string | undefined): number | null {
  const found = String(text ?? '').match(/\d+(?:[.,]\d+)?/)
  return found ? toNumber(found[0]) : null
}

export interface PricedLine {
  id: string
  label: string
  hours: number
  rate: number | null
  amount: number
  material: string
  materialAmount: number | null
}

export interface PricedGroup {
  title: string
  lines: PricedLine[]
  hours: number
  labour: number
  material: number
}

/**
 * The calculation of a visit priced with the rates of the offers: each position with hours, its hours × rate,
 * and the material as written (with its amount where it names one). Only positions with hours or material.
 */
export function priceCalculation(calc: Record<string, CalcValue>, rates: OfferRate[]) {
  const rateOf = new Map(rates.map((r) => [r.key, r.hourlyRate]))
  const groups: PricedGroup[] = CALCULATION.map((group) => {
    const lines = group.items
      .filter((item) => item.hours || item.material)
      .map((item) => {
        const value = calc[item.id] ?? {}
        const hours = item.hours ? toNumber(value.hours) : 0
        const rate = rateOf.get(item.id) ?? null
        return {
          id: item.id,
          label: item.label,
          hours,
          rate,
          amount: rate === null ? 0 : hours * rate,
          material: value.material?.trim() ?? '',
          materialAmount: materialAmount(value.material),
        }
      })
      .filter((line) => line.hours > 0 || line.material)
    return {
      title: group.title,
      lines,
      hours: lines.reduce((s, l) => s + l.hours, 0),
      labour: lines.reduce((s, l) => s + l.amount, 0),
      material: lines.reduce((s, l) => s + (l.materialAmount ?? 0), 0),
    }
  }).filter((group) => group.lines.length > 0)
  const labour = groups.reduce((s, g) => s + g.labour, 0)
  const material = groups.reduce((s, g) => s + g.material, 0)
  // Positions with hours but no rate yet: told, so that the sum is not taken for complete.
  const missing = groups.flatMap((g) => g.lines).filter((l) => l.hours > 0 && l.rate === null).map((l) => l.label)
  return { groups, hours: groups.reduce((s, g) => s + g.hours, 0), labour, material, net: labour + material, missing }
}

/** 1234.5 -> "1.234,50 €" */
export const euros = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
