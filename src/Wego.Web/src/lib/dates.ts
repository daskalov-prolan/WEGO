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

/** "ganztägig" for the whole day (no time, or 7–16 Uhr), else the time window, e.g. "8–10 Uhr". */
export function formatDayTime(entry: Pick<Entry, 'startTime' | 'endTime'>): string {
  const whole =
    !entry.startTime ||
    !entry.endTime ||
    (entry.startTime.startsWith(WHOLE_DAY.start) && entry.endTime.startsWith(WHOLE_DAY.end))
  return whole ? 'ganztägig' : formatTimeRange(entry)
}

export function formatHours(hours: number): string {
  return hours === 0 ? '–' : hours.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

export const CURRENT_YEAR = new Date().getFullYear()

/** The years of the calendar: always three years back and five ahead (their holidays come by themselves). */
export const PLAN_YEARS = Array.from({ length: 9 }, (_, i) => CURRENT_YEAR - 3 + i)

const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

export function addDays(iso: string, count: number): string {
  const date = parseIso(iso)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

/** Monday to Sunday of the week that contains the given day. */
export function weekOf(iso: string): Day[] {
  const monday = addDays(iso, -((parseIso(iso).getUTCDay() + 6) % 7))
  return daysBetween(monday, addDays(monday, 6))
}

/** "2026-10-12" -> "Montag, 12.10.2026" */
export function formatDateLong(iso: string): string {
  return `${WEEKDAYS_LONG[parseIso(iso).getUTCDay()]}, ${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

/** ISO 8601 week number ("KW"): the week that contains the Thursday decides the year. */
export function isoWeek(iso: string): number {
  const date = parseIso(iso)
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  return Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7)
}

/** All days of the month that contains the given day. */
export function monthOf(iso: string): Day[] {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return daysBetween(`${iso.slice(0, 8)}01`, `${iso.slice(0, 8)}${String(lastDay).padStart(2, '0')}`)
}

/** The first day of the month the given number of months away. */
export function addMonths(iso: string, count: number): string {
  const date = parseIso(`${iso.slice(0, 8)}01`)
  date.setUTCMonth(date.getUTCMonth() + count)
  return date.toISOString().slice(0, 10)
}

/** Full and half hours of a working day, "06:00" to "20:00": minutes are not needed on the sites. */
export const HALF_HOURS = Array.from(
  { length: 29 },
  (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
)

/** Two sites of four hours each on one day: the first in the morning, the second after the break. */
/** A whole working day, e.g. for widening half a day (the costing counts its hours). */
export const WHOLE_DAY = { start: '07:00', end: '16:00' }

export const HALF_DAYS = [
  { start: '07:30', end: '11:30' },
  { start: '12:00', end: '16:00' },
]
