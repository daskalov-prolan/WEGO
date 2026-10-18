import { notifications } from '@mantine/notifications'
import { useSyncExternalStore } from 'react'
import type { Entry, PlanEmployee, Site } from '../api/types'
import { allowedActivities, defaultActivity, isOpen } from './activities'
import type { DayChange } from './dragPlan'
import { toInput } from './ui'

/** Entries copied or cut in any plan view; cut ones leave their day when they are pasted. */
export interface Clip {
  label: string
  entries: Entry[]
  cut: boolean
}

let clip: Clip | null = null
const listeners = new Set<() => void>()

export function setClip(next: Clip | null) {
  clip = next
  for (const listener of listeners) listener()
}

/** The clipboard shared by all plan views: copied on the site page, pasted on the employee page. */
export function useClip(): Clip | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => clip,
  )
}

/** Puts these entries (one, or all of a day) on the clipboard. */
export function copyEntries(entries: Entry[], cut: boolean) {
  if (entries.length === 0) return
  setClip({ label: [...new Set(entries.map((entry) => entry.siteName ?? entry.type))].join(' / '), entries, cut })
}

/**
 * Where to paste: the day, and what the cell decides. A cell of an employee gives the employee (the site
 * stays), a cell of a site gives the site (the employee stays); a lane of a site on an employee's page both.
 */
export interface PasteTarget {
  date: string
  employeeId?: number
  siteId?: number
}

/**
 * The days to save for pasting: the copied entries are added to what is planned on the target days (a site
 * the employee is on that day already is not added twice). Who cannot do a copied activity gets their own
 * fitting one there. Cut entries leave their day in the same step. Vacation and sick days only go into cells
 * of employees.
 */
export function pasteChanges(
  copied: Clip,
  targets: PasteTarget[],
  entriesOf: (employeeId: number, date: string) => Entry[],
  employees: PlanEmployee[],
  siteById: Map<number, Site>,
): DayChange[] {
  const cutIds = new Set(copied.cut ? copied.entries.map((entry) => entry.id) : [])
  const days = new Map<string, DayChange>()
  const day = (employeeId: number, date: string) => {
    const key = `${employeeId}|${date}`
    let change = days.get(key)
    if (!change) {
      change = { employeeId, date, entries: entriesOf(employeeId, date).filter((entry) => !cutIds.has(entry.id)).map(toInput) }
      days.set(key, change)
    }
    return change
  }
  // Cut entries leave their days first, so pasting into the same day puts them back.
  for (const entry of copied.entries) if (cutIds.has(entry.id)) day(entry.employeeId, entry.date)

  for (const target of targets) {
    for (const entry of copied.entries) {
      if (target.siteId !== undefined && entry.type !== 'Baustelle') continue
      const employeeId = target.employeeId ?? entry.employeeId
      const siteId = entry.type === 'Baustelle' ? (target.siteId ?? entry.siteId) : null
      const change = day(employeeId, target.date)
      if (change.entries.some((other) => other.type === entry.type && other.siteId === siteId)) continue
      const employee = employees.find((candidate) => candidate.id === employeeId)
      const site = siteId === null ? undefined : siteById.get(siteId)
      const status = site && isOpen(site.status) ? site.status : undefined
      const fits = !employee || entry.type !== 'Baustelle' || (entry.activity !== null && allowedActivities(employee, status).includes(entry.activity))
      change.entries.push({
        ...toInput(entry),
        siteId,
        activity: fits ? entry.activity : employee ? defaultActivity(employee, status) : entry.activity,
      })
    }
  }
  return [...days.values()]
}

export interface ClipMenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
}

/**
 * The items of a right click on a cell: on one entry that entry (and its site), elsewhere in the cell or for
 * a day of several all of the cell; paste when something is on the clipboard.
 */
export function clipMenuItems({
  one,
  all,
  pasteLabel = 'Einfügen',
  onPaste,
  onOpenSite,
}: {
  one?: Entry
  all: Entry[]
  pasteLabel?: string
  onPaste: () => void
  onOpenSite?: (siteId: number) => void
}): ClipMenuItem[] {
  const copied = (entries: Entry[], cut: boolean) => () => {
    copyEntries(entries, cut)
    notifications.show({
      message: `${cut ? 'Ausgeschnitten' : 'Kopiert'}. Rechtsklick auf ein Feld und „Einfügen“.`,
      autoClose: 3000,
    })
  }
  const items: ClipMenuItem[] = []
  if (one) {
    if (one.siteId !== null && onOpenSite) items.push({ label: `Baustelle öffnen: ${one.siteName}`, onClick: () => onOpenSite(one.siteId!) })
    items.push(
      { label: `Kopieren: ${one.siteName ?? one.type}`, onClick: copied([one], false) },
      { label: `Ausschneiden: ${one.siteName ?? one.type}`, onClick: copied([one], true) },
    )
  }
  if (!one || all.length > 1)
    items.push(
      { label: one ? 'Ganzen Tag kopieren' : 'Kopieren', disabled: all.length === 0, onClick: copied(all, false) },
      { label: one ? 'Ganzen Tag ausschneiden' : 'Ausschneiden', disabled: all.length === 0, onClick: copied(all, true) },
    )
  items.push({ label: pasteLabel, disabled: clip === null, onClick: onPaste })
  return items
}
