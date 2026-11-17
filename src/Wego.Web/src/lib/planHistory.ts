import type { UndoStep } from './undoHandoff'

/** How many changes the undo arrow can take back one after the other. */
export const MAX_STEPS = 50

export interface PlanHistory {
  undo: UndoStep[]
  redo: UndoStep[]
}

/**
 * The changes of the plan since the page was loaded: kept here, not in the plan itself, so that they are still
 * there when the plan is opened again (the other phase, another page and back, another year).
 */
let kept: PlanHistory = { undo: [], redo: [] }

export const keptHistory = () => kept

export function keepHistory(history: PlanHistory) {
  kept = { undo: history.undo.slice(-MAX_STEPS), redo: history.redo.slice(-MAX_STEPS) }
}

/** For the tests: a page loaded anew. */
export function forgetHistory() {
  kept = { undo: [], redo: [] }
}
