import type { DragEvent } from 'react'
import type { Activity, DayEntryInput, Entry } from '../api/types'
import { toInput } from './ui'

/** What can be dragged in a plan: an entry of a cell, or an activity of a site that is not planned yet. */
export type DragItem = { kind: 'entry'; entry: Entry } | { kind: 'task'; siteId: number; activity: Activity }

export type DayChange = { employeeId: number; date: string; entries: DayEntryInput[] }

// The item being dragged. Browsers only reveal the dragged data on the drop, so it is kept here for the
// targets to decide while it is moved over them whether they take it.
let current: DragItem | null = null

/** For tests and for a drag that ended outside of the window. */
export const draggedItem = () => current

/** Makes an element draggable as this item; without `enabled` it stays as it is. */
export function dragSource(item: DragItem, enabled: boolean) {
  if (!enabled) return {}
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      // Dragging an end of an entry to make it longer or shorter: no drag of the entry itself.
      if (document.body.classList.contains('stretching')) {
        event.preventDefault()
        return
      }
      current = item
      document.body.classList.add('plan-dragging')
      event.dataTransfer?.setData('text/plain', item.kind === 'entry' ? (item.entry.siteName ?? item.entry.type) : item.activity)
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: () => {
      current = null
      document.body.classList.remove('plan-dragging')
      for (const element of document.querySelectorAll('.drop-over')) element.classList.remove('drop-over')
    },
  }
}

/**
 * Makes a cell of a plan a place to drop on. Only cells of the plans get these handlers: anywhere else
 * the browser shows that nothing can be dropped, and letting go there changes nothing.
 */
export function dropTarget(accepts: (item: DragItem) => boolean, onDrop: (item: DragItem) => void, enabled = true) {
  if (!enabled) return {}
  const takes = () => current !== null && accepts(current)
  return {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!takes()) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      event.currentTarget.classList.add('drop-over')
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      // Moving onto a chip inside the cell is still over the cell.
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      event.currentTarget.classList.remove('drop-over')
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.currentTarget.classList.remove('drop-over')
      const item = current
      if (!item || !accepts(item)) return
      event.preventDefault()
      current = null
      document.body.classList.remove('plan-dragging')
      onDrop(item)
    },
  }
}

/** Where an entry is moved to: another day, employee or site, and the activity it has there. */
export interface MoveTarget {
  employeeId: number
  date: string
  siteId: number | null
  activity: Activity | null
}

/** Whether an entry would stay where it is. */
export const staysPut = (entry: Entry, to: Omit<MoveTarget, 'activity'>) =>
  entry.employeeId === to.employeeId && entry.date === to.date && entry.siteId === to.siteId

/**
 * The days to save when an entry is moved: it leaves its day and joins what is planned on the new one.
 * If the employee is on that site that day already, the two become one.
 */
export function moveChanges(entry: Entry, to: MoveTarget, entriesOf: (employeeId: number, date: string) => Entry[]): DayChange[] {
  const moved: DayEntryInput = { ...toInput(entry), siteId: to.siteId, activity: to.activity }
  const sameDay = entry.employeeId === to.employeeId && entry.date === to.date
  const rest = entriesOf(entry.employeeId, entry.date).filter((other) => other.id !== entry.id)
  const target = sameDay ? rest : entriesOf(to.employeeId, to.date)
  const there = entry.type === 'Baustelle' && target.some((other) => other.type === 'Baustelle' && other.siteId === to.siteId)
  const joined = [...target.map(toInput), ...(there ? [] : [moved])]
  if (sameDay) return [{ employeeId: to.employeeId, date: to.date, entries: joined }]
  return [
    { employeeId: entry.employeeId, date: entry.date, entries: rest.map(toInput) },
    { employeeId: to.employeeId, date: to.date, entries: joined },
  ]
}
