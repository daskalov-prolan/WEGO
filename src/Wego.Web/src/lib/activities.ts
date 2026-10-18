import type { CSSProperties } from 'react'
import type { Activity, Entry, SiteStatus } from '../api/types'

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

/**
 * The activities in the order of the job, each belonging to one status of the site. The construction
 * keeps the colours the planners know from the Excel sheet: Besichtigung türkis, Abriss rot, Trockenbau
 * orange, Sanitär blau, RenoDeco lila, Fliesenarbeiten magenta, Endmontage ein anderes (dunkleres) Blau.
 */
export const ACTIVITIES: ActivityInfo[] = [
  { value: 'Besichtigung', label: 'Besichtigung', phase: 'Angebot', background: '#5fd6cf', tint: '#d2f4f1', edge: '#0f9c93' },
  { value: 'Angebotskalkulation', label: 'Angebotskalkulation', phase: 'Angebot', background: '#a1887f', tint: '#ece5e2', edge: '#795548' },
  { value: 'Angebotsbesprechung', label: 'Angebotsbesprechung', phase: 'Angebot', background: '#b5bd3a', tint: '#eff1c9', edge: '#827717' },
  { value: 'Abriss', label: 'Abriss / Baubeginn', phase: 'Bauphase', background: '#f46a6a', tint: '#fdd9d9', edge: '#d32f2f' },
  { value: 'Trockenbau', label: 'Trockenbau', phase: 'Bauphase', background: '#ffc000', tint: '#ffeeb8', edge: '#e0a200' },
  { value: 'Sanitaer', label: 'Sanitär', phase: 'Bauphase', background: '#7db4f2', tint: '#d9e8fb', edge: '#1e6fd9' },
  { value: 'RenoDeco', label: 'RenoDeco-Platten', phase: 'Bauphase', background: '#c49be3', tint: '#ece0f7', edge: '#8b45c2' },
  { value: 'Fliesen', label: 'Fliesenarbeiten', phase: 'Bauphase', background: '#f472c9', tint: '#fcd8f0', edge: '#cf2f98' },
  { value: 'Endmontage', label: 'Endmontage', phase: 'Bauphase', background: '#3f51b5', tint: '#d6dbf3', edge: '#3f51b5' },
]

export const SITE_STATUSES: { value: SiteStatus; label: string; color: string }[] = [
  { value: 'Angebot', label: 'Angebot', color: 'cyan' },
  { value: 'Bauphase', label: 'Bauphase', color: 'orange' },
  { value: 'Abgeschlossen', label: 'Abgeschlossen', color: 'green' },
  { value: 'Storniert', label: 'Storniert', color: 'red' },
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

const BY_VALUE = new Map(ACTIVITIES.map((activity) => [activity.value, activity]))

export const NO_ACTIVITY: Colours = { background: '#b8c6ca', tint: '#e9eff1', edge: '#8fa3a8' }
/** Urlaub and Krank are yellow, as in the Excel sheet. */
export const ABSENCE: Colours = { background: '#ffeb3b', tint: '#fff6bd', edge: '#d4b800' }
/** Feiertage are green, school holidays a lighter green. */
export const PUBLIC_HOLIDAY: Colours = { background: '#5cc46a', tint: '#d9f2dc', edge: '#2e9e3e' }
export const SCHOOL_HOLIDAY: Colours = { background: '#d3f0d6', tint: '#eef9ef', edge: '#8fd29a' }
export function activityLabel(activity: Activity | null | undefined): string | null {
  return activity ? (BY_VALUE.get(activity)?.label ?? null) : null
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
  return activity ? `${entry.siteName} – ${activity}` : (entry.siteName ?? '')
}

/**
 * The activities the plan offers for an employee: the main activity first, then the additional ones.
 * Somebody without any configured activity can be planned for everything.
 */
export function allowedActivities(
  employee: { mainActivity: Activity | null; additionalActivities: Activity[] },
  status?: SiteStatus,
): Activity[] {
  const own = [employee.mainActivity, ...employee.additionalActivities].filter((a): a is Activity => a !== null)
  const all = own.length > 0 ? [...new Set(own)] : ACTIVITIES.map((activity) => activity.value)
  if (!status) return all
  // On a site only the activities of its status: what the employee can do of them.
  const ofStatus = activitiesOfStatus(status)
  return all.filter((activity) => ofStatus.includes(activity))
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
