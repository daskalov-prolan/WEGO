import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'

export type StretchSide = 'left' | 'right'

/** A stretch of days being dragged longer or shorter at one of its ends. */
interface Stretch {
  /** The cells of one row carry `data-stretch-row` with this value and `data-stretch-date`. */
  row: string
  from: string
  to: string
  side: StretchSide
  /** Called with the new first and last day once the mouse is let go (only if they changed). */
  done: (from: string, to: string) => void
}

const marks = ['stretch-add', 'stretch-remove']

function clearMarks() {
  for (const element of document.querySelectorAll('.stretch-add, .stretch-remove')) element.classList.remove(...marks)
}

/**
 * Dragging the left or right end of an entry: the cells of its row under the pointer decide the new first
 * or last day; cells that would be added or removed are marked while dragging. Returns the function that
 * starts it, for the pointer-down of a handle.
 */
export function useStretch() {
  const active = useRef<(Stretch & { newFrom: string; newTo: string }) | null>(null)

  useEffect(() => {
    const paint = () => {
      const current = active.current
      if (!current) return
      clearMarks()
      for (const cell of document.querySelectorAll<HTMLElement>('[data-stretch-row]')) {
        if (cell.dataset.stretchRow !== current.row) continue
        const date = cell.dataset.stretchDate!
        const inNew = date >= current.newFrom && date <= current.newTo
        const inOld = date >= current.from && date <= current.to
        if (inNew && !inOld) cell.classList.add('stretch-add')
        else if (inOld && !inNew) cell.classList.add('stretch-remove')
      }
    }
    const move = (event: PointerEvent) => {
      const current = active.current
      if (!current) return
      const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-stretch-date]')
      if (!cell || cell.dataset.stretchRow !== current.row) return
      const date = cell.dataset.stretchDate!
      // The other end stays; this end can come back to it, but not past it.
      if (current.side === 'right') current.newTo = date < current.from ? current.from : date
      else current.newFrom = date > current.to ? current.to : date
      paint()
    }
    const up = () => {
      const current = active.current
      if (!current) return
      active.current = null
      document.body.classList.remove('stretching')
      clearMarks()
      // The click that ends the drag is no click on a cell.
      const swallow = (event: MouseEvent) => {
        event.stopPropagation()
        event.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
      if (current.newFrom !== current.from || current.newTo !== current.to) current.done(current.newFrom, current.newTo)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  return (stretch: Stretch, event: ReactPointerEvent) => {
    // Neither a selection of cells nor dragging the entry somewhere else.
    event.preventDefault()
    event.stopPropagation()
    active.current = { ...stretch, newFrom: stretch.from, newTo: stretch.to }
    document.body.classList.add('stretching')
  }
}
