import type { CSSProperties, TouchEvent } from 'react'
import { useRef } from 'react'
import type { DayEntryInput, Entry } from '../api/types'

/** Identifies one employee's day, e.g. in a selection of cells. */
export const cellKey = (employeeId: number, date: string) => `${employeeId}|${date}`

/** A stable hue per construction site, spread around the colour wheel by the golden angle. */
export function siteHue(customerId: number): number {
  return Math.round((customerId * 137.508) % 360)
}

/** Inline style that hands the hue of a site to the CSS (see .chip and .cell-code in app.css). */
export function siteStyle(customerId: number | null | undefined): CSSProperties | undefined {
  return customerId == null ? undefined : ({ '--site-h': siteHue(customerId) } as CSSProperties)
}

export function toInput(entry: Entry): DayEntryInput {
  return {
    type: entry.type,
    customerName: entry.customerName,
    startTime: entry.startTime,
    endTime: entry.endTime,
    note: entry.note,
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
