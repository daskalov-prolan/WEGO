import type { Entry } from '../api/types'

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
export const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

export interface Day {
  /** yyyy-MM-dd */
  iso: string
  month: number
  dayOfMonth: number
  weekday: string
  isWeekend: boolean
}

function toDay(date: Date): Day {
  const weekday = date.getUTCDay()
  return {
    iso: date.toISOString().slice(0, 10),
    month: date.getUTCMonth(),
    dayOfMonth: date.getUTCDate(),
    weekday: WEEKDAYS[weekday],
    isWeekend: weekday === 0 || weekday === 6,
  }
}

function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

/** All days from start to end, both included. Calculated in UTC so that daylight saving time cannot shift a day. */
export function daysBetween(startIso: string, endIso: string): Day[] {
  const days: Day[] = []
  const end = parseIso(endIso).getTime()
  for (let date = parseIso(startIso); date.getTime() <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    days.push(toDay(date))
  }
  return days
}

export function daysOfYear(year: number): Day[] {
  return daysBetween(`${year}-01-01`, `${year}-12-31`)
}

export function todayIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** "2026-03-02" -> "Mo 02.03.2026" */
export function formatDate(iso: string): string {
  const day = toDay(parseIso(iso))
  return `${day.weekday} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

/** "08:00:00" -> "8", "08:30:00" -> "8:30" */
function formatTime(time: string): string {
  const [hours, minutes] = time.split(':')
  return minutes === '00' ? String(Number(hours)) : `${Number(hours)}:${minutes}`
}

/** "8–10 Uhr", or an empty string for an entry without a time window. */
export function formatTimeRange(entry: Pick<Entry, 'startTime' | 'endTime'>): string {
  if (!entry.startTime || !entry.endTime) return ''
  return `${formatTime(entry.startTime)}–${formatTime(entry.endTime)} Uhr`
}

export function formatHours(hours: number): string {
  return hours === 0 ? '–' : hours.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

export const CURRENT_YEAR = new Date().getFullYear()
