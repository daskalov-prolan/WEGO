import type { DayChange } from './dragPlan'

/** A change of the plan that the undo arrow takes back as a whole. */
export interface UndoStep {
  label: string
  before: DayChange[]
  after: DayChange[]
}

const KEY = 'wego.plan.undo'

/**
 * A change made outside the plan (e.g. the standard flow entered on the page of a site): the plan opened next
 * offers to take it back with its undo arrow.
 */
export function handOverUndo(step: UndoStep) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(step))
  } catch {
    // Without storage it cannot be taken back from the plan.
  }
}

/** The change handed over, if any; forget it with forgetHandedUndo once taken. */
export function handedUndo(): UndoStep | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as UndoStep) : null
  } catch {
    return null
  }
}

export function forgetHandedUndo() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nothing kept.
  }
}
