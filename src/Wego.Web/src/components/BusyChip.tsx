import type { OwnBusy } from '../api/types'
import { busyTime } from '../lib/busy'

/**
 * A time busy after the own calendar of an employee (e.g. Apple's): only "belegt", nothing of what it is; in red
 * when something of the plan is at that time as well (named in the tooltip).
 */
export function BusyChip({ busy, clashes }: { busy: OwnBusy; clashes: string[] }) {
  const clash = clashes.length > 0
  return (
    <span
      className={clash ? 'busy-chip clash' : 'busy-chip'}
      title={`Privat belegt ${busyTime(busy)}${clash ? ` · Überschneidung mit ${clashes.join(', ')}` : ''}`}
    >
      <span className="busy-chip-name">{clash ? '⚠ belegt' : 'belegt'}</span>
      <span className="busy-chip-time">{busyTime(busy)}</span>
    </span>
  )
}
