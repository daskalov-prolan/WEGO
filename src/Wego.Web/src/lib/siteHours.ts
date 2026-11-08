import type { Entry } from '../api/types'

/** A day without a time window counts as a full day: 07:30–16:00 with half an hour of break. */
export const FULL_DAY_HOURS = 8

/** The hours of an entry: its time window, or a full day without one. */
export function hoursOf(entry: Pick<Entry, 'startTime' | 'endTime'>): number {
  if (!entry.startTime || !entry.endTime) return FULL_DAY_HOURS
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
  return Math.max(0, minutes(entry.endTime) - minutes(entry.startTime)) / 60
}

export interface HoursRow {
  id: number
  name: string
  days: number
  hours: number
}

/** Days and hours of each employee on a site, most days first. */
export function rowsOf(entries: Entry[]): HoursRow[] {
  const rows = new Map<number, HoursRow & { dates: Set<string> }>()
  for (const entry of entries) {
    const row = rows.get(entry.employeeId) ?? { id: entry.employeeId, name: entry.employeeName, days: 0, hours: 0, dates: new Set() }
    row.dates.add(entry.date)
    row.hours += hoursOf(entry)
    rows.set(entry.employeeId, row)
  }
  return [...rows.values()]
    .map(({ dates, ...row }) => ({ ...row, days: dates.size }))
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'de'))
}

export const euro = (value: number) => value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
