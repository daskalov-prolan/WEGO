import type { CSSProperties } from 'react'
import type { Activity, Entry } from '../api/types'

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
}

/**
 * The activities on a construction site in the order of the job, with the colours the planners know
 * from the Excel sheet: Besichtigung türkis, Abriss rot, Trockenbau orange, Sanitär blau,
 * RenoDeco lila, Fliesenarbeiten magenta, Endmontage ein anderes (dunkleres) Blau.
 */
export const ACTIVITIES: ActivityInfo[] = [
  { value: 'Besichtigung', label: 'Besichtigung', background: '#5fd6cf', tint: '#d2f4f1', edge: '#0f9c93' },
  { value: 'Abriss', label: 'Abriss / Baubeginn', background: '#f46a6a', tint: '#fdd9d9', edge: '#d32f2f' },
  { value: 'Trockenbau', label: 'Trockenbau', background: '#ffc000', tint: '#ffeeb8', edge: '#e0a200' },
  { value: 'Sanitaer', label: 'Sanitär', background: '#7db4f2', tint: '#d9e8fb', edge: '#1e6fd9' },
  { value: 'RenoDeco', label: 'RenoDeco-Platten', background: '#c49be3', tint: '#ece0f7', edge: '#8b45c2' },
  { value: 'Fliesen', label: 'Fliesenarbeiten', background: '#f472c9', tint: '#fcd8f0', edge: '#cf2f98' },
  { value: 'Endmontage', label: 'Endmontage', background: '#3f51b5', tint: '#d6dbf3', edge: '#3f51b5' },
]

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
export function allowedActivities(employee: { mainActivity: Activity | null; additionalActivities: Activity[] }): Activity[] {
  const own = [employee.mainActivity, ...employee.additionalActivities].filter((a): a is Activity => a !== null)
  return own.length > 0 ? [...new Set(own)] : ACTIVITIES.map((activity) => activity.value)
}
