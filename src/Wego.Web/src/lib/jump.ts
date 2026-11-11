/**
 * Jumps a scrolled box to a place at once, also while it still glides from a wipe: Safari on the iPhone keeps
 * the glide going and drops a position set meanwhile (Heute then did nothing, or stopped short). Taking the
 * scrolling away for a moment ends the glide; nothing snaps into place while it jumps.
 */
export function jumpTo(element: HTMLElement, place: { left?: number; top?: number }) {
  const { overflow, scrollSnapType } = element.style
  element.style.overflow = 'hidden'
  element.style.scrollSnapType = 'none'
  const set = () => {
    if (place.left !== undefined) element.scrollLeft = place.left
    if (place.top !== undefined) element.scrollTop = place.top
  }
  set()
  requestAnimationFrame(() => {
    element.style.overflow = overflow
    set()
    requestAnimationFrame(() => {
      element.style.scrollSnapType = scrollSnapType
    })
  })
}
