import type { CSSProperties } from 'react'
import type { Activity, ActivityDef, Entry, SiteStatus } from '../api/types'
import { formatTimeRange } from './dates'

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
  '#d71f27': { tint: '#f8d2d4', edge: '#d71f27' },
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

/** Dark writing in the hue of a light colour (on Helltürkis, Bernstein, Greige). */
const DARK_ON: Record<string, string> = { Objektauswahl: '#06323d', Angebotsuebergabe: '#3a2200', Trockenbau: '#000000' }

/** Writing on the full colour of an activity: white on a dark one (always on the red of the logo), dark on a light one. */
export function textOfActivity(activity: string | null | undefined): string {
  const info = activity ? BY_VALUE.get(activity) : undefined
  if (!info) return '#14232a'
  if (info.background === '#d71f27') return '#ffffff'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(info.background.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? (DARK_ON[info.value] ?? '#14232a') : '#ffffff'
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
    ['Anfrage', 'Anfrage', 'Angebot', '#0b4a5e'],
    ['Besichtigung', 'Besichtigung', 'Angebot', '#0f6378'],
    ['Objektauswahl', 'Objektauswahl', 'Angebot', '#5fb3c6'],
    ['Angebotsuebergabe', 'Angebotsübergabe', 'Angebot', '#f07a2a'],
    ['Abriss', 'Abriss / Baubeginn', 'Bauphase', '#d71f27'],
    ['Trockenbau', 'Trockenbau', 'Bauphase', '#e9dccb'],
    ['Sanitaer', 'Sanitär', 'Bauphase', '#0f6378'],
    ['RenoDeco', 'RenoDeco-Platten', 'Bauphase', '#f07a2a'],
    ['Fliesen', 'Fliesenarbeiten', 'Bauphase', '#ad8fb0'],
    ['Endmontage', 'Endmontage', 'Bauphase', '#0f6378'],
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
  { value: 'Bauphase', label: 'Bauphase', color: 'wegoRed', hex: '#d71f27' },
  { value: 'Abgeschlossen', label: 'Erledigt', color: 'green', hex: '#2f9e44' },
  // Grey: the red is the Bauphase's.
  { value: 'Storniert', label: 'Storniert', color: 'gray', hex: '#868e96' },
  // The customer said no to the offer.
  { value: 'Abgelehnt', label: 'Abgelehnt', color: 'dark', hex: '#5c5f66' },
]

/** What the customer may want done (Umfang), as on the server. */
export const SCOPES = [
  'Komplettsanierung Bad',
  'Gäste-WC',
  'Duschumbau',
  'Wanne zu Dusche',
  'Nur Fliesen',
  'Nur Sanitär',
  'Sanierung Wohnung / Haus',
  'Sonstiges',
]

/** Why a customer said no, as on the server; "Sonstiges" needs a few words. */
export const DECLINE_REASONS = [
  'Preis zu hoch',
  'Anderer Anbieter beauftragt',
  'Baubeginn zu spät / Termin passt nicht',
  'Vorhaben verschoben',
  'Finanzierung oder Förderung nicht geklärt',
  'Keine Rückmeldung mehr',
  'Sonstiges',
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
/** Free ("verfügbar"): sage green, filled in the calendar like the sites. */
/** verfügbar: light green with black writing. */
export const FREE: Colours = { background: '#9fd4a6', tint: '#e2f2e4', edge: '#3f7d52' }
/** Urlaub and Krank are yellow, as in the Excel sheet. */
/** Urlaub and Krank: light yellow with black writing. */
export const ABSENCE: Colours = { background: '#f7de6e', tint: '#f7de6e', edge: '#000000' }
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

/**
 * Inline style that hands the colours of an entry to the CSS (see .chip, .cell-compact, .my-entry).
 * An activity also gets --entry-fill and --entry-text: in the calendar its field is filled with the full colour,
 * written so it can be read (see textOfActivity); Urlaub and Krank, and verfügbar, in black.
 */
export function entryStyle(entry: Pick<Entry, 'type' | 'activity'> & Partial<Pick<Entry, 'siteName'>>): CSSProperties {
  const found = colours(entry)
  const { background, tint, edge } = found
  // Activities and the free half (verfügbar); Urlaub, Krank and entries without activity stay light.
  const filled = found !== ABSENCE && found !== NO_ACTIVITY
  return {
    '--entry-bg': tint,
    '--entry-strong': background,
    '--entry-color': edge,
    ...(filled ? { '--entry-fill': background, '--entry-text': found === FREE ? '#000000' : textOfActivity(entry.activity) } : {}),
    ...(found === ABSENCE ? { '--entry-text': ABSENCE.edge } : {}),
  } as CSSProperties
}

/**
 * A day reserved for a site still in the offer phase and without Baubeginn: no activity (and so no colour) yet.
 * Shown framed in black on white; once the Baubeginn is entered, activities colour it.
 */
export function isReservation(
  entry: Pick<Entry, 'type' | 'activity'>,
  site: { status: string; plannedStart: string | null } | undefined,
): boolean {
  return entry.type === 'Baustelle' && !entry.activity && site?.status === 'Angebot' && !site.plannedStart
}

/** Tooltip text: customer and activity, or Urlaub / Krank. */
export function entryTitle(entry: Pick<Entry, 'type' | 'activity' | 'siteName'> & Partial<Pick<Entry, 'startTime' | 'endTime'>>): string {
  if (entry.type !== 'Baustelle') return entry.type
  if (isFree(entry)) return 'verfügbar: noch keine Baustelle'
  const activity = activityLabel(entry.activity)
  if (!entry.siteName) return activity ? `${activity} (Baustelle noch offen)` : ''
  // An appointment of the offer: the step first, then the customer and the time.
  if (activity && isMarkedStep(entry.activity)) {
    const time = formatTimeRange({ startTime: entry.startTime ?? null, endTime: entry.endTime ?? null })
    return [activity, entry.siteName, time].filter(Boolean).join(' · ')
  }
  return activity ? `${entry.siteName} – ${activity}` : entry.siteName
}

/** The steps of the offer that show their sign in front of the customer in the calendar (the visits have their own card). */
export const isMarkedStep = (activity: Activity | null | undefined) => activity === 'Objektauswahl' || activity === 'Angebotsuebergabe'

/** A craftsman unless said otherwise; a planner when said so. */
type Skilled = { isPlaner?: boolean; isCraftsman?: boolean; mainActivity?: Activity | null; additionalActivities?: Activity[] }

/**
 * The activities the plan offers for an employee: a craftsman (a row in the plan) does all activities of the
 * construction phase, a planner all of the offer phase; somebody can be both. A craftsman can do some of the offer
 * phase as well (e.g. visits, see Verwaltung): with them he is in the offer phase too.
 */
export function allowedActivities(employee: Skilled, status?: SiteStatus): Activity[] {
  const offer = activitiesOfStatus('Angebot')
  const planner = !!employee.isPlaner
  const all = [
    ...(planner ? offer : offer.filter((activity) => employee.additionalActivities?.includes(activity))),
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
  const allowed = allowedActivities(employee, status)
  // The main activity of a craftsman (see Verwaltung) where it fits, else the first of the phase.
  return employee.mainActivity && allowed.includes(employee.mainActivity) ? employee.mainActivity : (allowed[0] ?? null)
}

/** The name of an appointment not confirmed yet starts with "? " (see the server). Null: none. */
export function tentativeName(name: string): string | null {
  return name.startsWith('? ') ? name.slice(2) : null
}

/** The name of a service call starts with "SE: " (see the server): in the plan its sign takes that place. Null: no service call. */
export function serviceName(name: string): string | null {
  return name.startsWith('SE: ') ? name.slice(4) : null
}
