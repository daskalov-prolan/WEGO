import type { ReactNode } from 'react'
import type { Activity, EntryType } from '../api/types'

// Simple line drawings on a 16×16 grid, drawn in the current text colour.
const PATHS: Record<Activity | 'Urlaub' | 'Krank', ReactNode> = {
  // magnifying glass
  Besichtigung: (
    <>
      <circle cx="6.5" cy="6.5" r="4.2" />
      <path d="M9.6 9.6 14 14" />
    </>
  ),
  // calculator
  Angebotskalkulation: (
    <>
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
      <path d="M5.5 4.5h5M5.5 8h.01M8 8h.01M10.5 8h.01M5.5 11h.01M8 11h.01M10.5 11h.01" />
    </>
  ),
  // two speech bubbles
  Angebotsbesprechung: (
    <>
      <path d="M1.5 2.5h8v5.5H5L2.5 10V8h-1z" />
      <path d="M11 5.5h3.5V11h-1v2l-2.5-2H7.5V9.5" />
    </>
  ),
  // hammer
  Abriss: (
    <>
      <path d="M2.5 4.5 6 1.5l3 2.5-1.5 1.5z" />
      <path d="M7 5 14 12.5l-1.5 1.5L5.5 6.5" />
    </>
  ),
  // board with screws (drywall)
  Trockenbau: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 8h12M8 2v12" />
    </>
  ),
  // drop of water
  Sanitaer: <path d="M8 1.8c2.8 3.6 4.4 6 4.4 8.2A4.4 4.4 0 0 1 3.6 10c0-2.2 1.6-4.6 4.4-8.2z" />,
  // wall panel with a diagonal joint
  RenoDeco: (
    <>
      <rect x="3" y="1.5" width="10" height="13" rx="1" />
      <path d="M3 11 13 5" />
    </>
  ),
  // tiles in a grid
  Fliesen: (
    <>
      <rect x="1.8" y="1.8" width="5.4" height="5.4" />
      <rect x="8.8" y="1.8" width="5.4" height="5.4" />
      <rect x="1.8" y="8.8" width="5.4" height="5.4" />
      <rect x="8.8" y="8.8" width="5.4" height="5.4" />
    </>
  ),
  // wrench
  Endmontage: (
    <path d="M10.5 1.8a3.6 3.6 0 0 0-3.2 5L2 12.1 3.9 14l5.3-5.3a3.6 3.6 0 0 0 5-3.2L12 7.6 9.4 7 8.8 4.4z" />
  ),
  // sun
  Urlaub: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3 3l1.3 1.3M11.7 11.7 13 13M3 13l1.3-1.3M11.7 4.3 13 3" />
    </>
  ),
  // thermometer
  Krank: (
    <>
      <path d="M6.5 9.5V3a1.5 1.5 0 0 1 3 0v6.5a3 3 0 1 1-3 0z" />
      <path d="M8 6v5" />
    </>
  ),
}

interface Props {
  activity?: Activity | null
  /** Urlaub and Krank get a sign of their own. */
  type?: EntryType
  size?: number
}

/** A small sign for an activity (or for Urlaub / Krank), shown at the start of an entry. */
export function ActivityIcon({ activity, type = 'Baustelle', size = 12 }: Props) {
  const key = type === 'Baustelle' ? activity : type
  if (!key) return null
  return (
    <svg
      className="activity-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      // The activity is always named next to the sign (or in the tooltip), so the sign itself stays silent.
      aria-hidden
      data-activity={key}
    >
      {PATHS[key]}
    </svg>
  )
}
