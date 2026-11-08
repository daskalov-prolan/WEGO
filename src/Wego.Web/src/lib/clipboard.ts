import { notifications } from '@mantine/notifications'
import { useSyncExternalStore } from 'react'
import type { CalendarNote, Entry, PlanEmployee, Site } from '../api/types'
import { allowedActivities, defaultActivity, entryName, isOpen } from './activities'
import { addDays } from './dates'
import type { DayChange } from './dragPlan'
import { toInput } from './ui'

/** Entries copied or cut in any plan view; cut ones leave their day when they are pasted. */
export interface Clip {
  label: string
  entries: Entry[]
  cut: boolean
  /** The notes of the copied days (or one note alone), pasted into the fields of the employees. */
  notes?: CalendarNote[]
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

/** Puts these entries (one, all of a day, or the days of a selection) and notes on the clipboard. */
export function copyEntries(entries: Entry[], cut: boolean, notes: CalendarNote[] = []) {
  if (entries.length === 0 && notes.length === 0) return
  const names = [...new Set(entries.map((entry) => entryName(entry)))]
  const days = new Set(entries.map((entry) => entry.date)).size
  const label = [...names, ...notes.map((note) => `Notiz „${note.title}“`)].join(' / ')
  setClip({ label: days > 1 ? `${days} Tage: ${label}` : label, entries, cut, notes })
}

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000)

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
 * of employees. `isWorkday`: pasted into several fields, vacation leaves out weekends and public holidays.
 *
 * Entries of several days keep their distance in days: the first copied day goes to the first target day,
 * the others follow. Copied from one employee, they go to each employee of the targets; copied from several,
 * each employee keeps their own (only the days move).
 */
export function pasteChanges(
  copied: Clip,
  targets: PasteTarget[],
  entriesOf: (employeeId: number, date: string) => Entry[],
  employees: PlanEmployee[],
  siteById: Map<number, Site>,
  isWorkday: (date: string) => boolean = () => true,
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

  // Every copied entry with the day (and the cell) it goes to.
  const copiedDays = [...new Set(copied.entries.map((entry) => entry.date))].sort()
  let placed: { entry: Entry; date: string; target: PasteTarget }[]
  if (copiedDays.length > 1 && targets.length > 0) {
    const shift = dayDiff(copiedDays[0], targets.map((target) => target.date).sort()[0])
    const oneEmployee = new Set(copied.entries.map((entry) => entry.employeeId)).size === 1
    const employeeIds = [...new Set(targets.flatMap((target) => (target.employeeId === undefined ? [] : [target.employeeId])))]
    // A site cell, or entries of several employees: one run of days; else one for each employee chosen.
    const runs: PasteTarget[] =
      oneEmployee && employeeIds.length > 0 ? employeeIds.map((employeeId) => ({ date: '', employeeId })) : [{ date: '', siteId: targets[0].siteId }]
    placed = runs.flatMap((run) =>
      copied.entries.map((entry) => {
        const date = addDays(entry.date, shift)
        return { entry, date, target: { ...run, date } }
      }),
    )
  } else placed = targets.flatMap((target) => copied.entries.map((entry) => ({ entry, date: target.date, target })))
  const several = new Set(placed.map(({ date, target }) => `${target.employeeId}|${date}`)).size > 1

  for (const { entry, target } of placed) {
    if (target.siteId !== undefined && entry.type !== 'Baustelle') continue
    // Vacation over two weeks: Saturday, Sunday and public holidays are no vacation days. One field alone is
    // what was meant.
    if (entry.type === 'Urlaub' && several && !isWorkday(target.date)) continue
    const employeeId = target.employeeId ?? entry.employeeId
    const siteId = entry.type === 'Baustelle' ? (target.siteId ?? entry.siteId) : null
    const change = day(employeeId, target.date)
    // A site (or a vacation) only once a day; visits whose site is still open may be several.
    const open = entry.type === 'Baustelle' && siteId === null
    if (!open && change.entries.some((other) => other.type === entry.type && other.siteId === siteId)) continue
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
  onDelete,
  notes = [],
}: {
  one?: Entry
  all: Entry[]
  /** The notes in the cell: copying all of the cell takes them along. */
  notes?: CalendarNote[]
  pasteLabel?: string
  onPaste: () => void
  onOpenSite?: (siteId: number) => void
  /** Removes these entries; without it the menu offers no deleting. */
  onDelete?: (entries: Entry[]) => void
}): ClipMenuItem[] {
  const copied = (entries: Entry[], cut: boolean, withNotes: CalendarNote[] = []) => () => {
    copyEntries(entries, cut, withNotes)
    notifications.show({
      message: `${cut ? 'Ausgeschnitten' : 'Kopiert'}. Rechtsklick auf ein Feld und „Einfügen“.`,
      autoClose: 3000,
    })
  }
  const items: ClipMenuItem[] = []
  if (one) {
    if (one.siteId !== null && onOpenSite) items.push({ label: `Baustelle öffnen: ${one.siteName}`, onClick: () => onOpenSite(one.siteId!) })
    items.push(
      { label: `Kopieren: ${entryName(one)}`, onClick: copied([one], false) },
      { label: `Ausschneiden: ${entryName(one)}`, onClick: copied([one], true) },
    )
  }
  if (!one || all.length > 1)
    items.push(
      {
        label: one ? 'Ganzen Tag kopieren' : 'Kopieren',
        disabled: all.length === 0 && notes.length === 0,
        onClick: copied(all, false, notes),
      },
      {
        label: one ? 'Ganzen Tag ausschneiden' : 'Ausschneiden',
        disabled: all.length === 0 && notes.length === 0,
        onClick: copied(all, true, notes),
      },
    )
  items.push({ label: pasteLabel, disabled: clip === null, onClick: onPaste })
  if (onDelete && one) items.push({ label: `Löschen: ${entryName(one)}`, onClick: () => onDelete([one]) })
  if (onDelete && (!one || all.length > 1))
    items.push({ label: one ? 'Ganzen Tag löschen' : 'Löschen', disabled: all.length === 0, onClick: () => onDelete(all) })
  return items
}
