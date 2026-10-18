import { Paper } from '@mantine/core'
import { useEffect, useRef } from 'react'

export interface CellMenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
}

/**
 * A small menu at the mouse pointer, e.g. for a right click on a cell. It closes on a click elsewhere,
 * on Escape and when the page scrolls.
 */
export function CellMenu({ x, y, items, onClose }: { x: number; y: number; items: CellMenuItem[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  // Near the right or bottom edge the menu opens to the other side of the pointer.
  const left = Math.min(x, window.innerWidth - 220)
  const top = Math.min(y, window.innerHeight - 40 * items.length - 16)

  return (
    <Paper ref={menu} shadow="md" withBorder className="cell-menu" style={{ left, top }} role="menu" onContextMenu={(event) => event.preventDefault()}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="cell-menu-item"
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onClick()
          }}
        >
          {item.label}
        </button>
      ))}
    </Paper>
  )
}
