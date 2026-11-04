import type { CSSProperties } from 'react'
import type { Activity, ActivityDef, Entry, SiteStatus } from '../api/types'

export interface Colours {
  /** The full colour, as in the Excel sheet: legend, colour bar, year view. */
  background: string
  /** A light tint of it, behind text: dark text stays easy to read on every activity. */
  tint: string
  /** Stronger shade for the colour bar on the left of an entry. */
  edge: string
}

export interface ActivityInfo extends Colours {
  value: Activity
  label: string
  /** The status of a site this activity belongs to. */
  phase: 'Angebot' | 'Bauphase'
}

// The colours the planners know from the Excel sheet, with a tint and an edge chosen by hand.
const TUNED: Record<string, { tint: string; edge: string }> = {
  '#5fd6cf': { tint: '#d2f4f1', edge: '#0f9c93' },
  '#a1887f': { tint: '#ece5e2', edge: '#795548' },
  '#b5bd3a': { tint: '#eff1c9', edge: '#827717' },
  // Since November 2026: the light petrol and the petrol of the header for the offer phase, the red of the logo
  // for Abriss.
  '#3aa6c0': { tint: '#cdeaf1', edge: '#1f7f96' },
  '#0f6378': { tint: '#cfe3e8', edge: '#08394a' },
  '#d71f27': { tint: '#f8d2d4', edge: '#a3141a' },
  '#f46a6a': { tint: '#fdd9d9', edge: '#d32f2f' },
  '#ffc000': { tint: '#ffeeb8', edge: '#e0a200' },
  '#7db4f2': { tint: '#d9e8fb', edge: '#1e6fd9' },
  '#c49be3': { tint: '#ece0f7', edge: '#8b45c2' },
  '#f472c9': { tint: '#fcd8f0', edge: '#cf2f98' },
  '#3f51b5': { tint: '#d6dbf3', edge: '#3f51b5' },
}

/** A colour mixed with another, e.g. with white for a tint: amount 0 keeps it, 1 gives the other. */
function mix(hex: string, other: string, amount: number) {
  const channels = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16))
  const [a, b] = [channels(hex), channels(other)]
  return `#${a.map((c, i) => Math.round(c + (b[i] - c) * amount).toString(16).padStart(2, '0')).join('')}`
}

/** Text on a full colour: white on dark and strong ones, dark on light ones such as yellow. */
export function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#14232a' : '#ffffff'
}

/** The three colours of an activity from its one colour: tuned by hand for the known ones, mixed for others. */
export function coloursOf(color: string): Colours {
  const background = color.toLowerCase()
  return { background, ...(TUNED[background] ?? { tint: mix(background, '#ffffff', 0.75), edge: mix(background, '#000000', 0.3) }) }
}

const toInfo = (def: ActivityDef): ActivityInfo => ({ value: def.key, label: def.label, phase: def.phase, ...coloursOf(def.color) })

/**
 * The activities in the order of the job, each belonging to one phase of a site. They are kept under
 * Verwaltung and loaded after signing in (see setActivities); until then, and in tests, these are the ones.
 */
export let ACTIVITIES: ActivityInfo[] = (
  [
    ['Besichtigung', 'Besichtigung', 'Angebot', '#3aa6c0'],
    ['Objektauswahl', 'Objektauswahl', 'Angebot', '#0f6378'],
    ['Angebotsuebergabe', 'Angebotsübergabe', 'Angebot', '#e8590c'],
    ['Abriss', 'Abriss / Baubeginn', 'Bauphase', '#d71f27'],
    ['Trockenbau', 'Trockenbau', 'Bauphase', '#fd7e14'],
    ['Sanitaer', 'Sanitär', 'Bauphase', '#1c7ed6'],
    ['RenoDeco', 'RenoDeco-Platten', 'Bauphase', '#7048e8'],
    ['Fliesen', 'Fliesenarbeiten', 'Bauphase', '#d6336c'],
    ['Endmontage', 'Endmontage', 'Bauphase', '#1c7ed6'],
  ] as const
).map(([key, label, phase, color], index) => toInfo({ key, label, phase, color, sortOrder: index + 1 }))

let BY_VALUE = new Map(ACTIVITIES.map((activity) => [activity.value, activity]))

/** Takes the activities as the server keeps them; everything that shows activities reads them from here. */
export function setActivities(defs: ActivityDef[]) {
  ACTIVITIES = [...defs].sort((a, b) => a.sortOrder - b.sortOrder).map(toInfo)
  BY_VALUE = new Map(ACTIVITIES.map((activity) => [activity.value, activity]))
}

/** color: Mantine colour of the badges; hex: the same colour for the process diagram of the legend. */
export const SITE_STATUSES: { value: SiteStatus; label: string; color: string; hex: string }[] = [
  { value: 'Angebot', label: 'Angebotsphase', color: 'cyan', hex: '#1098ad' },
  { value: 'Bauphase', label: 'Bauphase', color: 'orange', hex: '#e8590c' },
  { value: 'Abgeschlossen', label: 'Erledigt', color: 'green', hex: '#2f9e44' },
  { value: 'Storniert', label: 'Storniert', color: 'red', hex: '#e03131' },
]

/** Done or cancelled: nothing is planned there any more. */
export const isOpen = (status: SiteStatus) => status === 'Angebot' || status === 'Bauphase'

/** The status a site may change to: one step forward. Cancelling is no longer offered. */
export function nextStatuses(status: SiteStatus): SiteStatus[] {
  // A done site can go back to the construction phase when there is more to do after all.
  return status === 'Angebot' ? ['Bauphase'] : status === 'Bauphase' ? ['Abgeschlossen'] : status === 'Abgeschlossen' ? ['Bauphase'] : []
}

/** The activities of a site in this status; none once it is done or cancelled. */
export function activitiesOfStatus(status: SiteStatus): Activity[] {
  return ACTIVITIES.filter((activity) => activity.phase === status).map((activity) => activity.value)
}


export const NO_ACTIVITY: Colours = { background: '#b8c6ca', tint: '#e9eff1', edge: '#8fa3a8' }
/** Free ("verfügbar"): a fresh green, stronger than the green of the holidays behind the days. */
export const FREE: Colours = { background: '#40c057', tint: '#c3f0ca', edge: '#2b8a3e' }
/** Urlaub and Krank are yellow, as in the Excel sheet. */
export const ABSENCE: Colours = { background: '#ffc61a', tint: '#ffe27a', edge: '#e0a000' }
/** Feiertage are green, school holidays a lighter green. */
export const PUBLIC_HOLIDAY: Colours = { background: '#5cc46a', tint: '#d9f2dc', edge: '#2e9e3e' }
export const SCHOOL_HOLIDAY: Colours = { background: '#d3f0d6', tint: '#eef9ef', edge: '#8fd29a' }
export function activityLabel(activity: Activity | null | undefined): string | null {
  return activity ? (BY_VALUE.get(activity)?.label ?? null) : null
}

export const activityInfo = (activity: Activity): ActivityInfo | undefined => BY_VALUE.get(activity)

/**
 * Work without a site that is no visit of the offer phase (e.g. the second half of a split day not given to a
 * site yet): the employee is free then.
 */
export function isFree(entry: Pick<Entry, 'type' | 'activity' | 'siteName'>): boolean {
  if (entry.type !== 'Baustelle' || entry.siteName) return false
  return !entry.activity || BY_VALUE.get(entry.activity)?.phase !== 'Angebot'
}

/**
 * Work on sites for half a day at most (every entry with its time window, together no more than 4.5 hours)
 * and nothing else that day: the rest of the day the employee is free. A day with Urlaub or Krank, with a
 * row kept free already or without times is not.
 */
export function onlyHalfDay(entries: Pick<Entry, 'type' | 'activity' | 'siteName' | 'startTime' | 'endTime'>[]): boolean {
  if (entries.length === 0) return false
  let hours = 0
  for (const entry of entries) {
    if (entry.type !== 'Baustelle' || isFree(entry) || !entry.startTime || !entry.endTime) return false
    const [startH, startM] = entry.startTime.split(':').map(Number)
    const [endH, endM] = entry.endTime.split(':').map(Number)
    hours += endH + endM / 60 - (startH + startM / 60)
  }
  return hours <= 4.5
}

/** What an entry is called in the plan: its site, or (planned before the site is known) its activity. */
export function entryName(entry: Pick<Entry, 'type' | 'activity' | 'siteName'>): string {
  if (entry.type !== 'Baustelle') return entry.type
  if (isFree(entry)) return 'verfügbar'
  return entry.siteName ?? activityLabel(entry.activity) ?? ''
}

function colours(entry: Pick<Entry, 'type' | 'activity'> & Partial<Pick<Entry, 'siteName'>>): Colours {
  if (entry.type !== 'Baustelle') return ABSENCE
  // Only a saved entry is free; a row being edited (no site name known) keeps the colour of its activity.
  if (entry.siteName === null && isFree({ ...entry, siteName: null })) return FREE
  return (entry.activity && BY_VALUE.get(entry.activity)) || NO_ACTIVITY
}

/** Inline style that hands the colours of an entry to the CSS (see .chip, .cell-compact, .my-entry). */
export function entryStyle(entry: Pick<Entry, 'type' | 'activity'> & Partial<Pick<Entry, 'siteName'>>): CSSProperties {
  const { background, tint, edge } = colours(entry)
  return { '--entry-bg': tint, '--entry-strong': background, '--entry-color': edge } as CSSProperties
}

/** Tooltip text: customer and activity, or Urlaub / Krank. */
export function entryTitle(entry: Pick<Entry, 'type' | 'activity' | 'siteName'>): string {
  if (entry.type !== 'Baustelle') return entry.type
  if (isFree(entry)) return 'verfügbar: noch keine Baustelle'
  const activity = activityLabel(entry.activity)
  if (!entry.siteName) return activity ? `${activity} (Baustelle noch offen)` : ''
  return activity ? `${entry.siteName} – ${activity}` : entry.siteName
}

/** A craftsman unless said otherwise; a planner when said so. */
type Skilled = { isPlaner?: boolean; isCraftsman?: boolean }

/**
 * The activities the plan offers for an employee: a craftsman (a row in the plan) does all activities of the
 * construction phase, a planner all of the offer phase; somebody can be both.
 */
export function allowedActivities(employee: Skilled, status?: SiteStatus): Activity[] {
  const all = [
    ...(employee.isPlaner ? activitiesOfStatus('Angebot') : []),
    ...(employee.isCraftsman !== false ? activitiesOfStatus('Bauphase') : []),
  ]
  if (!status) return all
  // On a site only the activities of its status: what the employee can do of them.
  const ofStatus = activitiesOfStatus(status)
  return all.filter((activity) => ofStatus.includes(activity))
}

/** Who appears in a phase of the plan: the planners in the offer phase, the craftsmen in the construction phase. */
export function worksInPhase(employee: Skilled, phase: 'Angebot' | 'Bauphase'): boolean {
  return allowedActivities(employee, phase).length > 0
}

/** The activity a new entry gets: the first the employee can do in the status of the site, otherwise none. */
export function defaultActivity(employee: Skilled, status?: SiteStatus): Activity | null {
  return allowedActivities(employee, status)[0] ?? null
}
