import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { api, messageOf } from '../api/client'
import type { Entry, Plan } from '../api/types'
import { addDays, daysBetween, weekOf, type Day } from './dates'

/** Where to look first: the week of the earliest entry at the site; without one the given fallback. */
function firstWeek(all: Entry[], siteId: number, fallback: string): string {
  const first = all
    .filter((entry) => entry.siteId === siteId && entry.type === 'Baustelle')
    .reduce<string | null>((earliest, entry) => (earliest === null || entry.date < earliest ? entry.date : earliest), null)
  return first ? weekOf(first)[0].iso : fallback
}

export interface DayStrip {
  /** Monday of the first week in view; follows the scrolling. */
  visible: string
  /** The days drawn; they grow by four weeks when one scrolls near an end. */
  days: Day[]
  /** The years of the days drawn and the next one, all loaded. */
  years: number[]
  plans: Plan[]
  entries: Entry[]
  publicHolidays: Set<string>
  error: string
  reload: () => void
  /** Brings the week of this Monday to the left edge. */
  go: (monday: string) => void
  /** Call before saving: the days stay where they are until the saved plan is drawn again. */
  keepPosition: () => void
  scroller: RefObject<HTMLDivElement | null>
  onScroll: () => void
}

/**
 * Days as columns that scroll sideways without end, with the plans of the years they touch. Opens at the
 * given Monday, or with `focusSiteId` at the week of the first work at that site. Planning keeps the week
 * in view, also when a drag scrolled the days near an edge.
 */
export function useDayStrip(start: string, focusSiteId?: number): DayStrip {
  const [visible, setVisible] = useState(start)
  const scroller = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ from: addDays(start, -14), to: addDays(start, 41) })
  // Width of the strip before it grew to the left: the scroll position is moved by what was added.
  const grownLeft = useRef<number | null>(null)
  // The position from before planning, put back once the saved plan is drawn. `keptFor` is the plan drawn before.
  const kept = useRef<{ left: number; keptFor: Plan[] | null } | null>(null)
  const dragging = useRef(false)
  // A week to bring to the left edge once it is drawn (first load, arrows, jumps) – not on every reload.
  const scrollTarget = useRef<string | null>(start)
  const days = daysBetween(range.from, range.to)
  const firstYear = Number(range.from.slice(0, 4))
  const lastYear = Number(range.to.slice(0, 4)) + 1
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index)
  const yearsKey = years.join(',')

  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState('')
  // The first load decides where the days start; later loads (after planning, scrolling) keep the position.
  const positioned = useRef(false)

  const reload = useCallback(() => {
    Promise.all(yearsKey.split(',').map((year) => api.plan(Number(year)))).then(
      (loaded) => {
        setPlans(loaded)
        if (!positioned.current) {
          positioned.current = true
          if (focusSiteId === undefined) return
          const first = firstWeek(loaded.flatMap((plan) => plan.entries), focusSiteId, start)
          setVisible(first)
          scrollTarget.current = first
          setRange({ from: addDays(first, -14), to: addDays(first, 41) })
        }
      },
      (e) => setError(messageOf(e)),
    )
  }, [yearsKey, focusSiteId, start])
  useEffect(reload, [reload])

  const entries = useMemo(() => plans.flatMap((plan) => plan.entries), [plans])
  const publicHolidays = useMemo(() => {
    const set = new Set<string>()
    for (const holiday of plans.flatMap((plan) => plan.schoolHolidays)) {
      if (holiday.kind !== 'Feiertag') continue
      for (let iso = holiday.startDate; iso <= holiday.endDate; iso = addDays(iso, 1)) set.add(iso)
    }
    return set
  }, [plans])

  const go = (monday: string) => {
    setVisible(monday)
    scrollTarget.current = monday
    // A week outside of what is drawn: draw around it again.
    if (monday < range.from || addDays(monday, 13) > range.to) setRange({ from: addDays(monday, -14), to: addDays(monday, 41) })
  }

  const keepPosition = () => {
    if (scroller.current) kept.current = { left: kept.current?.left ?? scroller.current.scrollLeft, keptFor: plans }
  }

  // The names stay at the left edge and cover the start of the scrolled days.
  const nameWidth = () => scroller.current?.querySelector<HTMLElement>('.mini-corner')?.offsetWidth ?? 0

  // While something is dragged the days stay where they were when it started.
  useEffect(() => {
    const begin = () => {
      dragging.current = true
      if (scroller.current) kept.current = { left: scroller.current.scrollLeft, keptFor: null }
    }
    const end = () => {
      dragging.current = false
      if (scroller.current && kept.current) scroller.current.scrollLeft = kept.current.left
      // Dropped nowhere: nothing is saved, so nothing to wait for.
      if (kept.current?.keptFor === null) kept.current = null
    }
    window.addEventListener('dragstart', begin)
    window.addEventListener('dragend', end)
    return () => {
      window.removeEventListener('dragstart', begin)
      window.removeEventListener('dragend', end)
    }
  }, [])

  // After planning: back to the week that was in view, once the saved plan is drawn.
  useLayoutEffect(() => {
    const keep = kept.current
    if (!keep || dragging.current || !scroller.current || keep.keptFor === null || keep.keptFor === plans) return
    scroller.current.scrollLeft = keep.left
    kept.current = null
  })

  // Bring the chosen week to the left edge as soon as it is drawn.
  useLayoutEffect(() => {
    const target = scrollTarget.current
    const column = target && document.getElementById(`mini-${target}`)
    if (!scroller.current || !column || plans.length === 0) return
    scroller.current.scrollTo?.({ left: column.offsetLeft - nameWidth() })
    scrollTarget.current = null
  })

  // After growing to the left, keep the same days in view.
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || grownLeft.current === null) return
    element.scrollLeft += element.scrollWidth - grownLeft.current
    grownLeft.current = null
  }, [range.from])

  const onScroll = () => {
    const element = scroller.current
    if (!element) return
    const left = element.scrollLeft
    // Near an end: four more weeks into the past or the future.
    if (left < 150 && grownLeft.current === null) {
      grownLeft.current = element.scrollWidth
      setRange((current) => ({ ...current, from: addDays(current.from, -28) }))
    } else if (left + element.clientWidth > element.scrollWidth - 150) {
      setRange((current) => ({ ...current, to: addDays(current.to, 28) }))
    }
    const first = [...element.querySelectorAll<HTMLElement>('.mini-day')].find(
      (column) => column.offsetLeft + column.offsetWidth > left + nameWidth() + 1,
    )
    const monday = first ? weekOf(first.id.slice(5))[0].iso : visible
    if (monday !== visible) setVisible(monday)
  }

  return { visible, days, years, plans, entries, publicHolidays, error, reload, go, keepPosition, scroller, onScroll }
}

/** The working days (Mon–Fri) of the week of this Monday that are no public holiday. */
export function workdaysOf(monday: string, publicHolidays: Set<string>): string[] {
  return [0, 1, 2, 3, 4].map((offset) => addDays(monday, offset)).filter((iso) => !publicHolidays.has(iso))
}

export const percent = (share: number | null) => (share === null ? '–' : `${Math.round(share * 100)} %`)
