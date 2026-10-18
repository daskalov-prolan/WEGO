import type { CSSProperties } from 'react'
import type { Activity, Entry } from '../api/types'

export interface ActivityInfo {
  value: Activity
  label: string
  /** Strong colour for borders and swatches, light one for backgrounds. */
  color: string
  background: string
}

/** The activities on a construction site, in the order of the job. Their colours mark the entries in the plan. */
export const ACTIVITIES: ActivityInfo[] = [
  { value: 'Besichtigung', label: 'Besichtigung', color: '#0a9cb8', background: '#d8f2f7' },
  { value: 'Abriss', label: 'Abriss / Baubeginn', color: '#c62828', background: '#fadcdc' },
  { value: 'Trockenbau', label: 'Trockenbau', color: '#8d6e3f', background: '#f2e8d7' },
  { value: 'Sanitaer', label: 'Sanitär', color: '#1e5fc8', background: '#dde8fb' },
  { value: 'RenoDeco', label: 'RenoDeco-Platten', color: '#8a3fb0', background: '#eedff6' },
  { value: 'Fliesen', label: 'Fliesenarbeiten', color: '#e07000', background: '#fde6cf' },
  { value: 'Endmontage', label: 'Endmontage', color: '#1f9d55', background: '#d8f1e3' },
]

const BY_VALUE = new Map(ACTIVITIES.map((activity) => [activity.value, activity]))

const NO_ACTIVITY = { color: '#8fa3a8', background: '#edf2f3' }
const VACATION = { color: '#c9a000', background: '#fff3bf' }
const SICK = { color: '#5f6b6d', background: '#e3e6e7' }

export function activityLabel(activity: Activity | null | undefined): string | null {
  return activity ? (BY_VALUE.get(activity)?.label ?? null) : null
}

function colours(entry: Pick<Entry, 'type' | 'activity'>) {
  if (entry.type === 'Urlaub') return VACATION
  if (entry.type === 'Krank') return SICK
  return (entry.activity && BY_VALUE.get(entry.activity)) || NO_ACTIVITY
}

/** Inline style that hands the colours of an entry to the CSS (see .chip, .cell-compact, .my-entry). */
export function entryStyle(entry: Pick<Entry, 'type' | 'activity'>): CSSProperties {
  const { color, background } = colours(entry)
  return { '--entry-color': color, '--entry-bg': background } as CSSProperties
}

/** Tooltip text: customer and activity, or Urlaub / Krank. */
export function entryTitle(entry: Pick<Entry, 'type' | 'activity' | 'customerName'>): string {
  if (entry.type !== 'Baustelle') return entry.type
  const activity = activityLabel(entry.activity)
  return activity ? `${entry.customerName} – ${activity}` : (entry.customerName ?? '')
}
