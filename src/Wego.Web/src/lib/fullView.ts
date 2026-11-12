import { useEffect, useState } from 'react'

/**
 * Vollbild (a smartboard, a projector): the head and the menu of the page go, the browser fills the screen if it
 * can; leaving the browser's full screen (Esc) brings them back.
 */
export function useFullView() {
  const [full, setFull] = useState(false)
  useEffect(() => {
    document.documentElement.classList.toggle('plan-full', full)
    return () => document.documentElement.classList.remove('plan-full')
  }, [full])
  useEffect(() => {
    const left = () => {
      if (!document.fullscreenElement) setFull(false)
    }
    document.addEventListener('fullscreenchange', left)
    return () => document.removeEventListener('fullscreenchange', left)
  }, [])
  const toggle = () => {
    const next = !full
    setFull(next)
    if (next) document.documentElement.requestFullscreen?.().catch(() => {})
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }
  return { full, toggle }
}
