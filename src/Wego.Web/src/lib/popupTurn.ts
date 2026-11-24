import { useEffect, useReducer } from 'react'

/**
 * Windows that open by themselves (customers waiting for a call, new enquiries, service calls to confirm) take
 * turns: one at a time, the next once it is closed, never one over another (the page stayed locked behind them).
 */
const queue: string[] = []
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

function leave(id: string) {
  const at = queue.indexOf(id)
  if (at < 0) return
  queue.splice(at, 1)
  notify()
}

/** Whether the window named so may open now: it wants to, and no window before it is still open. */
export function usePopupTurn(id: string, wants: boolean): boolean {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    listeners.add(rerender)
    return () => {
      listeners.delete(rerender)
      leave(id)
    }
  }, [id])
  useEffect(() => {
    if (wants && !queue.includes(id)) {
      queue.push(id)
      notify()
    } else if (!wants) leave(id)
  }, [id, wants])
  return wants && queue[0] === id
}
