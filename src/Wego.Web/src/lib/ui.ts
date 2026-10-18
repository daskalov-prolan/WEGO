import type { TouchEvent } from 'react'
import { useRef } from 'react'
import type { DayEntryInput, Entry, SchoolHoliday } from '../api/types'
import { daysBetween } from './dates'

/** Identifies one employee's day, e.g. in a selection of cells. */
export const cellKey = (employeeId: number, date: string) => `${employeeId}|${date}`

export function toInput(entry: Entry): DayEntryInput {
  return {
    type: entry.type,
    siteId: entry.siteId,
    activity: entry.activity,
    startTime: entry.startTime,
    endTime: entry.endTime,
    note: entry.note,
    noteImportant: entry.noteImportant,
  }
}

/** Horizontal swipe on touch screens, e.g. to the previous or next week. Vertical scrolling is left alone. */
export function useSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches[0]
      start.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null
    },
    onTouchEnd: (event: TouchEvent) => {
      const from = start.current
      start.current = null
      const touch = event.changedTouches[0]
      if (!from || !touch) return
      const dx = touch.clientX - from.x
      const dy = touch.clientY - from.y
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return
      if (dx < 0) onLeft()
      else onRight()
    },
  }
}

/** Holiday per day. A Feiertag wins over school holidays on the same day. */
export function holidaysByDate(holidays: SchoolHoliday[]): Map<string, SchoolHoliday> {
  const map = new Map<string, SchoolHoliday>()
  const ordered = [...holidays].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'Feiertag' ? 1 : -1))
  for (const holiday of ordered) {
    for (const day of daysBetween(holiday.startDate, holiday.endDate)) map.set(day.iso, holiday)
  }
  return map
}
