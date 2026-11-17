import { notifications } from '@mantine/notifications'
import { useEffect, useRef } from 'react'
import { api } from '../api/client'

/** How often the page asks whether somebody else changed something. */
const EVERY = 20_000

/** A window open or something being dragged: the page waits with loading anew until it is done. */
const busy = () =>
  document.querySelector('[role="dialog"]') !== null ||
  document.body.classList.contains('plan-dragging') ||
  document.body.classList.contains('stretching')

/**
 * Loads the page anew (reload) when somebody else changed something: it asks the server in the background every 20
 * seconds, and at once when the page is looked at again; not while it lies hidden. While a window is open or
 * something is dragged, it waits until that is done, so that nothing being entered is lost. Says who changed it.
 */
export function useLiveChanges(reload: () => void) {
  const latest = useRef(reload)
  latest.current = reload

  useEffect(() => {
    // Not in the tests: there the server is played and asked for nothing else.
    if (import.meta.env.MODE === 'test') return
    let seen: number | null = null
    // Changed by others, not loaded yet (waiting for a window to close): who.
    let pending: Set<string> | null = null

    const apply = () => {
      if (!pending || busy()) return
      const names = [...pending]
      pending = null
      latest.current()
      notifications.show({
        message: names.length > 0 ? `Aktualisiert: geändert von ${names.join(', ')}` : 'Aktualisiert: es gab Änderungen',
        color: 'teal',
      })
    }

    const check = async () => {
      if (document.hidden) return
      apply()
      try {
        const changes = await api.changes()
        if (seen === null || changes.version < seen) {
          seen = changes.version
          return
        }
        if (changes.version === seen) return
        const since = seen
        seen = changes.version
        const others = changes.recent.filter((change) => change.version > since && change.byId !== changes.you)
        // More changes than the server keeps (or it started anew): whose is not known, loaded all the same.
        const missed = changes.recent.length === 0 || changes.recent[0].version > since + 1
        if (others.length === 0 && !missed) return
        pending = new Set([...(pending ?? []), ...others.flatMap((change) => (change.by ? [change.by] : []))])
        apply()
      } catch {
        // Offline for a moment: asked again next time.
      }
    }

    void check()
    const timer = window.setInterval(check, EVERY)
    // Waiting for a window to close: looked at more often.
    const waiting = window.setInterval(apply, 2000)
    const onVisible = () => {
      if (!document.hidden) void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(waiting)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}
