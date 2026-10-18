import { ActionIcon, Alert, Button, Group, Paper, Text, Title, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, Entry, Plan, PlanEmployee, Site } from '../api/types'
import { activitiesOfStatus, activityLabel, allowedActivities, defaultActivity, isOpen } from '../lib/activities'
import { addDays, daysBetween, isoWeek, todayIso, weekOf, type Day } from '../lib/dates'
import { toInput } from '../lib/ui'
import { ActivityLegend } from './ActivityPicker'
import { Chip } from './Chip'
import type { OpenTask } from './PlanMatrix'
import { SiteDayDialog } from './SiteDayDialog'
import { TaskBox } from './TaskBox'

interface Props {
  site: Site
  canEdit: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Where to look first: the week of the earliest entry at the site with one of the chosen activities
 * (any activity without a filter); only without such an entry the given fallback (the planned start).
 */
function firstWeek(all: Entry[], activities: Set<Activity>, siteId: number, fallback: string): string {
  const first = all
    .filter((entry) => entry.siteId === siteId && entry.type === 'Baustelle')
    .filter((entry) => activities.size === 0 || (entry.activity !== null && activities.has(entry.activity)))
    .reduce<string | null>((earliest, entry) => (earliest === null || entry.date < earliest ? entry.date : earliest), null)
  return first ? weekOf(first)[0].iso : fallback
}

/**
 * Planning on the page of a site: the activities still to plan as boxes in a row, below them one lane per
 * employee whose main activity is still to plan here, with the days as columns that scroll sideways (about a
 * week in view, one and a half when there is room; weekends narrow). The work at this site stands out.
 */
export function SiteMiniPlan({ site, canEdit }: Props) {
  const today = todayIso()
  const buildStart = weekOf(site.plannedStart ?? today)[0].iso
  // Monday of the first week in view, follows the scrolling.
  const [visible, setVisible] = useState(buildStart)
  const scroller = useRef<HTMLDivElement>(null)
  // The days drawn; it grows by four weeks when one scrolls to its left or right end.
  const [range, setRange] = useState({ from: addDays(buildStart, -14), to: addDays(buildStart, 41) })
  // Width of the strip before it grew to the left: the scroll position is moved by what was added.
  const grownLeft = useRef<number | null>(null)
  // A week to bring to the left edge once it is drawn (first load, arrows, jumps) – not on every reload.
  const scrollTarget = useRef<string | null>(buildStart)
  const days = daysBetween(range.from, range.to)
  // The years of the days drawn and the next one: enough to find the next week with room.
  const firstYear = Number(range.from.slice(0, 4))
  const lastYear = Number(range.to.slice(0, 4)) + 1
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index)
  const yearsKey = years.join(',')

  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Set<Activity>>(new Set())
  const [openDay, setOpenDay] = useState<string | null>(null)
  // The first load decides where the days start; later loads (after planning, scrolling) keep the position.
  const positioned = useRef(false)
  const startFor = (all: Entry[], activities: Set<Activity>) => firstWeek(all, activities, site.id, buildStart)

  const reload = useCallback(() => {
    Promise.all(yearsKey.split(',').map((year) => api.plan(Number(year)))).then(
      (loaded) => {
        setPlans(loaded)
        if (!positioned.current) {
          positioned.current = true
          // No filter is chosen yet on the first load; later the filter jumps by itself when it changes.
          const first = firstWeek(loaded.flatMap((plan) => plan.entries), new Set(), site.id, buildStart)
          setVisible(first)
          scrollTarget.current = first
          setRange({ from: addDays(first, -14), to: addDays(first, 41) })
        }
      },
      (e) => setError(messageOf(e)),
    )
  }, [yearsKey, site.id, buildStart])
  useEffect(reload, [reload])

  const entries = useMemo(() => plans.flatMap((plan) => plan.entries), [plans])
  const employees: PlanEmployee[] = plans[0]?.employees ?? []
  const publicHolidays = useMemo(() => {
    const set = new Set<string>()
    for (const holiday of plans.flatMap((plan) => plan.schoolHolidays)) {
      if (holiday.kind !== 'Feiertag') continue
      for (let iso = holiday.startDate; iso <= holiday.endDate; iso = addDays(iso, 1)) set.add(iso)
    }
    return set
  }, [plans])

  // What each employee does on each day, at this site first.
  const byLaneDay = (() => {
    const map = new Map<string, Entry[]>()
    for (const entry of entries) {
      const key = `${entry.employeeId}|${entry.date}`
      map.set(key, [...(map.get(key) ?? []), entry])
    }
    for (const list of map.values()) list.sort((a, b) => Number(b.siteId === site.id) - Number(a.siteId === site.id))
    return map
  })()
  const hereOn = (date: string) => entries.filter((entry) => entry.date === date && entry.siteId === site.id)

  // Activities of the current status that have no entry at this site yet (in the loaded years).
  const openTasks: OpenTask[] = (() => {
    if (!isOpen(site.status)) return []
    const ofStatus = activitiesOfStatus(site.status)
    return site.tasks
      .filter((task) => ofStatus.includes(task.activity) && !task.notNeeded)
      .map((task) => ({
        activity: task.activity,
        planned: entries.filter((entry) => entry.siteId === site.id && entry.activity === task.activity).length,
        estimated: task.estimatedDays,
      }))
      .filter((task) => task.planned < task.estimated)
  })()

  // Who counts for how full a week is: everybody whose main activity is still to plan at this site.
  const openActivities = new Set(openTasks.map((task) => task.activity))
  // They are also the lanes of the calendar.
  const relevant = employees.filter((employee) => employee.mainActivity && openActivities.has(employee.mainActivity))
  const busy = new Set(entries.map((entry) => `${entry.employeeId}|${entry.date}`))

  /** Share of the working days (Mon–Fri, no public holidays) on which these people are planned anywhere. */
  const load = (monday: string): number | null => {
    if (relevant.length === 0) return null
    let capacity = 0
    let taken = 0
    for (let offset = 0; offset < 5; offset++) {
      const iso = addDays(monday, offset)
      if (publicHolidays.has(iso)) continue
      for (const employee of relevant) {
        capacity++
        if (busy.has(`${employee.id}|${iso}`)) taken++
      }
    }
    return capacity === 0 ? 1 : taken / capacity
  }

  // Who can take one of the open activities, as main or as additional activity.
  const capable = employees.filter((employee) =>
    [employee.mainActivity, ...employee.additionalActivities].some((activity) => activity !== null && openActivities.has(activity)),
  )

  /** Of these, who has no entry at all on the working days (Mon–Fri, no public holidays) of a week. */
  const freeIn = (monday: string): PlanEmployee[] => {
    const workdays = [0, 1, 2, 3, 4].map((offset) => addDays(monday, offset)).filter((iso) => !publicHolidays.has(iso))
    if (workdays.length === 0) return []
    return capable.filter((employee) => workdays.every((iso) => !busy.has(`${employee.id}|${iso}`)))
  }

  /** The next week after the first one in view in which one of them is still completely free; within the loaded years. */
  const nextFree = (() => {
    const lastDay = `${years[years.length - 1]}-12-31`
    for (let monday = addDays(visible, 7); monday <= lastDay; monday = addDays(monday, 7)) {
      const free = freeIn(monday)
      if (free.length > 0) return { monday, free }
    }
    return null
  })()

  const percent = (share: number | null) => (share === null ? '–' : `${Math.round(share * 100)} %`)

  const entriesOf = (employeeId: number, date: string) =>
    entries.filter((entry) => entry.employeeId === employeeId && entry.date === date)

  const save = async (changes: { employeeId: number; date: string; entries: ReturnType<typeof toInput>[] }[], message: string) => {
    await api.saveDays(changes)
    notifications.show({ message, color: 'green' })
    reload()
  }

  const plan = async (activity: Activity | null, employeeIds: number[], date: string) => {
    const changes = employeeIds.map((employeeId) => {
      const employee = employees.find((candidate) => candidate.id === employeeId)!
      return {
        employeeId,
        date,
        entries: [
          ...entriesOf(employeeId, date).map(toInput),
          {
            type: 'Baustelle' as const,
            siteId: site.id,
            activity: activity ?? defaultActivity(employee, site.status),
            startTime: null,
            endTime: null,
            note: null,
            noteImportant: false,
          },
        ],
      }
    })
    const what = activity ? activityLabel(activity) : `${changes.length} Mitarbeiter`
    await save(changes, `${what} am ${date.slice(8, 10)}.${date.slice(5, 7)}. eingeplant.`)
  }

  const go = (monday: string) => {
    setVisible(monday)
    scrollTarget.current = monday
    // A week outside of what is drawn: draw around it again.
    if (monday < range.from || addDays(monday, 13) > range.to) setRange({ from: addDays(monday, -14), to: addDays(monday, 41) })
  }

  // The names stay at the left edge and cover the start of the scrolled days.
  const nameWidth = () => scroller.current?.querySelector<HTMLElement>('.mini-corner')?.offsetWidth ?? 0

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

  const isDimmed = (entry: Entry) => filter.size > 0 && !(entry.activity && filter.has(entry.activity))

  const dayHead = (day: Day) => (
    <div
      key={day.iso}
      id={`mini-${day.iso}`}
      className={['mini-day', 'mini-day-head', day.isWeekend ? 'weekend' : '', day.iso === today ? 'today' : ''].join(' ')}
    >
      {/* Mondays carry the calendar week and how full it is. */}
      <span className="mini-week-mark" title="Auslastung der Mitarbeiter mit offener Haupttätigkeit">
        {day.weekday === 'Mo' ? `KW ${isoWeek(day.iso)} · ${percent(load(day.iso))}` : '\u00a0'}
      </span>
      <span className="wd">{day.weekday}</span>
      {!day.isWeekend && (
        <span className="num">
          {' '}
          {pad(day.dayOfMonth)}.{pad(day.month + 1)}.
        </span>
      )}
    </div>
  )

  return (
    <Paper withBorder p="md" mb="lg" className="mini-plan">
      <Group justify="space-between" mb="xs" gap="xs">
        <Title order={4}>Planung</Title>
        <Group gap={6}>
          <ActionIcon variant="default" onClick={() => go(addDays(visible, -7))} aria-label="Woche zurück">
            ‹
          </ActionIcon>
          <Text size="sm" fw={700} c="wego.9">
            KW {isoWeek(visible)} · ab {visible.slice(8, 10)}.{visible.slice(5, 7)}.
          </Text>
          <ActionIcon variant="default" onClick={() => go(addDays(visible, 7))} aria-label="Woche vor">
            ›
          </ActionIcon>
          {site.plannedStart && (
            <Button size="compact-sm" variant="default" onClick={() => go(buildStart)}>
              Baubeginn
            </Button>
          )}
          <Button size="compact-sm" variant="default" onClick={() => go(weekOf(today)[0].iso)}>
            Heute
          </Button>
          <Tooltip
            label={
              capable.length === 0
                ? 'Niemand kann eine der offenen Tätigkeiten.'
                : nextFree
                  ? `KW ${isoWeek(nextFree.monday)}: noch ganz frei sind ${nextFree.free.map((employee) => employee.name).join(', ')}`
                  : `In den geladenen Jahren ist niemand mehr eine ganze Woche frei, der eine offene Tätigkeit kann.`
            }
            multiline
            w={260}
          >
            <Button
              size="compact-sm"
              variant="light"
              disabled={!nextFree}
              onClick={() => nextFree && go(nextFree.monday)}
            >
              Nächste freie Woche ›
            </Button>
          </Tooltip>
        </Group>
      </Group>
      <ActivityLegend
        selected={filter}
        onChange={(next) => {
          setFilter(next)
          go(startFor(entries, next))
        }}
      />
      {error && (
        <Alert color="red" variant="light" mt="xs">
          {error}
        </Alert>
      )}

      <div className="mini-tasks">
        <Text size="xs" fw={700} c="dimmed">
          Ungeplant:
        </Text>
        {openTasks.length === 0 && (
          <Text size="xs" c="dimmed">
            alles eingeplant
          </Text>
        )}
        {openTasks.map((task) => (
          <TaskBox
            key={task.activity}
            task={task}
            employees={employees.filter((employee) => allowedActivities(employee, site.status).includes(task.activity))}
            defaultDate={weekOf(visible).find((day) => !day.isWeekend && day.iso >= today)?.iso ?? visible}
            minDate={`${years[0]}-01-01`}
            maxDate={`${years[years.length - 1]}-12-31`}
            onPlan={canEdit ? (employeeIds, date) => plan(task.activity, employeeIds, date) : undefined}
            onNotNeeded={
              canEdit
                ? async () => {
                    await api.updateSiteTask(site.id, task.activity, 1, true)
                    notifications.show({ message: `${activityLabel(task.activity)}: nicht nötig.` })
                    reload()
                  }
                : undefined
            }
          />
        ))}
      </div>

      <div className="mini-scroll" ref={scroller} onScroll={onScroll}>
        <div
          className="mini-lanes"
          style={{
            gridTemplateColumns: `var(--lane-name) ${days.map((day) => (day.isWeekend ? 'var(--weekend)' : 'var(--day)')).join(' ')}`,
          }}
        >
          <div className="mini-corner">Mitarbeiter</div>
          {days.map(dayHead)}
          {plans.length > 0 && relevant.length === 0 && (
            <Text size="sm" c="dimmed" className="mini-no-lanes">
              {openTasks.length === 0
                ? 'Alles eingeplant: keine offene Tätigkeit, für die Mitarbeiter gezeigt werden.'
                : 'Niemand hat eine der offenen Tätigkeiten als Haupttätigkeit.'}
            </Text>
          )}
          {relevant.map((employee) => (
            <Fragment key={employee.id}>
              <div className="mini-lane-name">
                <span className="name">{employee.name}</span>
                {employee.mainActivity && <span className="main">{activityLabel(employee.mainActivity)}</span>}
              </div>
              {days.map((day) => {
                const list = byLaneDay.get(`${employee.id}|${day.iso}`) ?? []
                return (
                  <button
                    key={day.iso}
                    type="button"
                    className={day.isWeekend ? 'mini-cell weekend' : 'mini-cell'}
                    aria-label={`${employee.name}, ${day.iso}`}
                    onClick={() => setOpenDay(day.iso)}
                  >
                    {list.map((entry) =>
                      entry.siteId === site.id ? (
                        <span key={entry.id} className="mini-here">
                          <Chip
                            entry={entry}
                            label={(entry.activity && activityLabel(entry.activity)) || undefined}
                            dimmed={isDimmed(entry)}
                          />
                        </span>
                      ) : (
                        <span key={entry.id} className="mini-elsewhere">
                          <Chip entry={entry} dimmed={isDimmed(entry)} />
                        </span>
                      ),
                    )}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
      {openDay && (
        <SiteDayDialog
          site={site}
          date={openDay}
          entries={hereOn(openDay)}
          employees={employees}
          canEdit={canEdit && isOpen(site.status)}
          onClose={() => setOpenDay(null)}
          onOpenSite={() => setOpenDay(null)}
          onAdd={(employeeIds) => plan(null, employeeIds, openDay)}
          onRemove={async (removed) => {
            await save(
              [
                {
                  employeeId: removed.employeeId,
                  date: removed.date,
                  entries: entriesOf(removed.employeeId, removed.date)
                    .filter((entry) => entry.id !== removed.id)
                    .map(toInput),
                },
              ],
              `${removed.employeeName} entfernt.`,
            )
          }}
        />
      )}
    </Paper>
  )
}
