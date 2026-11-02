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
    ['Besichtigung', 'Besichtigung', 'Angebot', '#5fd6cf'],
    ['Objektauswahl', 'Objektauswahl', 'Angebot', '#a1887f'],
    ['Angebotsuebergabe', 'Angebotsübergabe', 'Angebot', '#b5bd3a'],
    ['Abriss', 'Abriss / Baubeginn', 'Bauphase', '#f46a6a'],
    ['Trockenbau', 'Trockenbau', 'Bauphase', '#ffc000'],
    ['Sanitaer', 'Sanitär', 'Bauphase', '#7db4f2'],
    ['RenoDeco', 'RenoDeco-Platten', 'Bauphase', '#c49be3'],
    ['Fliesen', 'Fliesenarbeiten', 'Bauphase', '#f472c9'],
    ['Endmontage', 'Endmontage', 'Bauphase', '#3f51b5'],
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
  { value: 'Abgeschlossen', label: 'Abgeschlossen', color: 'green', hex: '#2f9e44' },
  { value: 'Storniert', label: 'Storniert', color: 'red', hex: '#e03131' },
]

/** Done or cancelled: nothing is planned there any more. */
export const isOpen = (status: SiteStatus) => status === 'Angebot' || status === 'Bauphase'

/** The status a site may change to: one step forward, or cancelled from anywhere but cancelled. */
export function nextStatuses(status: SiteStatus): SiteStatus[] {
  if (status === 'Storniert') return []
  const next: SiteStatus[] = status === 'Angebot' ? ['Bauphase'] : status === 'Bauphase' ? ['Abgeschlossen'] : []
  return [...next, 'Storniert']
}

/** The activities of a site in this status; none once it is done or cancelled. */
export function activitiesOfStatus(status: SiteStatus): Activity[] {
  return ACTIVITIES.filter((activity) => activity.phase === status).map((activity) => activity.value)
}


export const NO_ACTIVITY: Colours = { background: '#b8c6ca', tint: '#e9eff1', edge: '#8fa3a8' }
/** Urlaub and Krank are yellow, as in the Excel sheet. */
export const ABSENCE: Colours = { background: '#ffeb3b', tint: '#fff6bd', edge: '#d4b800' }
/** Feiertage are green, school holidays a lighter green. */
export const PUBLIC_HOLIDAY: Colours = { background: '#5cc46a', tint: '#d9f2dc', edge: '#2e9e3e' }
export const SCHOOL_HOLIDAY: Colours = { background: '#d3f0d6', tint: '#eef9ef', edge: '#8fd29a' }
export function activityLabel(activity: Activity | null | undefined): string | null {
  return activity ? (BY_VALUE.get(activity)?.label ?? null) : null
}

export const activityInfo = (activity: Activity): ActivityInfo | undefined => BY_VALUE.get(activity)

/** What an entry is called in the plan: its site, or (planned before the site is known) its activity. */
export function entryName(entry: Pick<Entry, 'type' | 'activity' | 'siteName'>): string {
  if (entry.type !== 'Baustelle') return entry.type
  return entry.siteName ?? activityLabel(entry.activity) ?? ''
}

function colours(entry: Pick<Entry, 'type' | 'activity'>): Colours {
  if (entry.type !== 'Baustelle') return ABSENCE
  return (entry.activity && BY_VALUE.get(entry.activity)) || NO_ACTIVITY
}

/** Inline style that hands the colours of an entry to the CSS (see .chip, .cell-compact, .my-entry). */
export function entryStyle(entry: Pick<Entry, 'type' | 'activity'>): CSSProperties {
  const { background, tint, edge } = colours(entry)
  return { '--entry-bg': tint, '--entry-strong': background, '--entry-color': edge } as CSSProperties
}

/** Tooltip text: customer and activity, or Urlaub / Krank. */
export function entryTitle(entry: Pick<Entry, 'type' | 'activity' | 'siteName'>): string {
  if (entry.type !== 'Baustelle') return entry.type
  const activity = activityLabel(entry.activity)
  if (!entry.siteName) return activity ? `${activity} (Baustelle noch offen)` : ''
  return activity ? `${entry.siteName} – ${activity}` : entry.siteName
}

type Skilled = { mainActivity: Activity | null; additionalActivities: Activity[]; isPlaner?: boolean }

const ownActivities = (employee: Skilled) =>
  [employee.mainActivity, ...employee.additionalActivities].filter((a): a is Activity => a !== null)

/**
 * The activities the plan offers for an employee: the main activity first, then the additional ones.
 * Somebody without any configured activity can be planned for everything; planners can do all
 * activities of the offer phase as well.
 */
export function allowedActivities(employee: Skilled, status?: SiteStatus): Activity[] {
  const own = ownActivities(employee)
  const all =
    own.length > 0
      ? [...new Set([...own, ...(employee.isPlaner ? activitiesOfStatus('Angebot') : [])])]
      : ACTIVITIES.map((activity) => activity.value)
  if (!status) return all
  // On a site only the activities of its status: what the employee can do of them.
  const ofStatus = activitiesOfStatus(status)
  return all.filter((activity) => ofStatus.includes(activity))
}

/**
 * Who appears in a phase of the plan. The offer phase: every planner, and whoever can do at least one of
 * its activities (set at the employee). The construction phase: whoever can do something there.
 */
export function worksInPhase(employee: Skilled, phase: 'Angebot' | 'Bauphase'): boolean {
  if (phase === 'Angebot') {
    const offer = activitiesOfStatus('Angebot')
    return Boolean(employee.isPlaner) || ownActivities(employee).some((activity) => offer.includes(activity))
  }
  return allowedActivities(employee, phase).length > 0
}

/**
 * The activity a new entry gets: the employee's main activity if it fits the status of the site,
 * otherwise the first of the employee's activities for that status, otherwise none.
 */
export function defaultActivity(
  employee: { mainActivity: Activity | null; additionalActivities: Activity[] },
  status?: SiteStatus,
): Activity | null {
  const allowed = allowedActivities(employee, status)
  if (employee.mainActivity && allowed.includes(employee.mainActivity)) return employee.mainActivity
  return allowed[0] ?? null
}
