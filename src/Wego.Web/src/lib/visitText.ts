import type { CallAttempt } from '../api/types'
import { formatDate, todayIso } from './dates'

/** "15.11. 10:15": when the customer was called last (the server keeps UTC). */
function callTime(call: CallAttempt) {
  const at = new Date(call.at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}. ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Not reached: when, by whom, how often. */
export const callLine = (call: CallAttempt) =>
  `Nicht erreicht: ${callTime(call)} · ${call.by}${call.count > 1 ? ` (${call.count}×)` : ''}`

const daysSince = (iso: string) => Math.round((Date.parse(todayIso()) - Date.parse(iso)) / 86_400_000)

/** "wartet seit heute", "seit 1 Tag", "seit 5 Tagen". */
export const waiting = (iso: string) => {
  const days = daysSince(iso)
  return days <= 0 ? 'wartet seit heute' : days === 1 ? 'wartet seit 1 Tag' : `wartet seit ${days} Tagen`
}

/** "Do 19.11." */
export const shortDate = (iso: string) => formatDate(iso).slice(0, -4)
