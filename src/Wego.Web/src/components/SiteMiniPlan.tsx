import { ActionIcon, Alert, Button, Group, Paper, Text, Title, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, Entry, Plan, PlanEmployee, Site } from '../api/types'
import { activitiesOfStatus, activityLabel, allowedActivities, defaultActivity, isOpen } from '../lib/activities'
import { addDays, isoWeek, todayIso, weekOf, type Day } from '../lib/dates'
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
 * Planning on the page of a site: the two calendar weeks from the planned start, one column per day.
 * The days show the work at this site and, below it, where the employees are elsewhere. The activities
 * still to plan are boxes on the left; a click plans them with employees and day.
 */
export function SiteMiniPlan({ site, canEdit }: Props) {
  const today = todayIso()
  const buildStart = weekOf(site.plannedStart ?? today)[0].iso
  // Monday of the first of the two weeks shown; moved with the arrows.
  const [start, setStart] = useState(buildStart)
  const weeks = [weekOf(start), weekOf(addDays(start, 7))]
  const days = weeks.flat()
  // The year shown and the next one: enough to find the next week with room.
  const firstYear = Number(start.slice(0, 4))
  const years = [firstYear, firstYear + 1]
  const yearsKey = years.join(',')

  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Set<Activity>>(new Set())
  const [openDay, setOpenDay] = useState<string | null>(null)
  // The first load decides where the two weeks start; later loads (after planning) keep the position.
  const positioned = useRef(false)
  const startFor = (all: Entry[], activities: Set<Activity>) => firstWeek(all, activities, site.id, buildStart)

  const reload = useCallback(() => {
    Promise.all(yearsKey.split(',').map((year) => api.plan(Number(year)))).then(
      (loaded) => {
        setPlans(loaded)
        if (!positioned.current) {
          positioned.current = true
          // No filter is chosen yet on the first load; later the filter jumps by itself when it changes.
          setStart(firstWeek(loaded.flatMap((plan) => plan.entries), new Set(), site.id, buildStart))
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

  // Work at this site and elsewhere, per day of the two weeks.
  const byDay = (() => {
    const map = new Map<string, { here: Entry[]; elsewhere: Entry[] }>()
    for (let offset = 0; offset < 14; offset++) map.set(addDays(start, offset), { here: [], elsewhere: [] })
    for (const entry of entries) {
      const slot = map.get(entry.date)
      if (!slot) continue
      if (entry.siteId === site.id) slot.here.push(entry)
      else slot.elsewhere.push(entry)
    }
    for (const slot of map.values()) slot.elsewhere.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'de'))
    return map
  })()

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

  /** The next week after the first one shown that is planned to less than half; within the loaded years. */
  const nextWithRoom = (() => {
    const lastDay = `${years[years.length - 1]}-12-31`
    for (let monday = addDays(start, 7); monday <= lastDay; monday = addDays(monday, 7)) {
      const share = load(monday)
      if (share !== null && share < 0.5) return monday
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

  const isDimmed = (entry: Entry) => filter.size > 0 && !(entry.activity && filter.has(entry.activity))

  const dayHead = (day: Day) => (
    <div className={['mini-day-head', day.isWeekend ? 'weekend' : '', day.iso === today ? 'today' : ''].join(' ')}>
      <span className="wd">{day.weekday}</span> {pad(day.dayOfMonth)}.{pad(day.month + 1)}.
    </div>
  )

  return (
    <Paper withBorder p="md" mb="lg" className="mini-plan">
      <Group justify="space-between" mb="xs" gap="xs">
        <Title order={4}>Planung</Title>
        <Group gap={6}>
          <ActionIcon variant="default" onClick={() => setStart(addDays(start, -7))} aria-label="Woche zurück">
            ‹
          </ActionIcon>
          <Text size="sm" fw={700} c="wego.9">
            KW {isoWeek(days[0].iso)}–{isoWeek(days[7].iso)}
          </Text>
          <ActionIcon variant="default" onClick={() => setStart(addDays(start, 7))} aria-label="Woche vor">
            ›
          </ActionIcon>
          {site.plannedStart && (
            <Button size="compact-sm" variant="default" onClick={() => setStart(buildStart)}>
              Baubeginn
            </Button>
          )}
          <Button size="compact-sm" variant="default" onClick={() => setStart(weekOf(today)[0].iso)}>
            Heute
          </Button>
          <Tooltip
            label={
              relevant.length === 0
                ? 'Niemand hat eine der offenen Tätigkeiten als Haupttätigkeit.'
                : `Gezählt: ${relevant.map((employee) => employee.name).join(', ')} (Haupttätigkeit offen auf dieser Baustelle)`
            }
            multiline
            w={260}
          >
            <Button
              size="compact-sm"
              variant="light"
              disabled={!nextWithRoom}
              onClick={() => nextWithRoom && setStart(nextWithRoom)}
            >
              Nächste Woche unter 50 % ›
            </Button>
          </Tooltip>
        </Group>
      </Group>
      <ActivityLegend
        selected={filter}
        onChange={(next) => {
          setFilter(next)
          setStart(startFor(entries, next))
        }}
      />
      {error && (
        <Alert color="red" variant="light" mt="xs">
          {error}
        </Alert>
      )}

      <div className="mini-grid">
        <div className="mini-tasks">
          <Text size="xs" fw={700} c="dimmed" mb={4}>
            Ungeplant
          </Text>
          {openTasks.length === 0 && (
            <Text size="xs" c="dimmed">
              Alles eingeplant.
            </Text>
          )}
          {openTasks.map((task) => (
            <TaskBox
              key={task.activity}
              task={task}
              employees={employees.filter((employee) => allowedActivities(employee, site.status).includes(task.activity))}
              defaultDate={days.find((day) => !day.isWeekend && day.iso >= today)?.iso ?? days[0].iso}
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

        <div className="mini-weeks">
          {weeks.map((week) => (
            <div className="mini-week" key={week[0].iso}>
              <div className="mini-week-label" title="Auslastung der Mitarbeiter mit offener Haupttätigkeit">
                KW {isoWeek(week[0].iso)} · {percent(load(week[0].iso))}
              </div>
              {week.map((day) => {
                const slot = byDay.get(day.iso)!
                return (
                  <div key={day.iso} className={day.isWeekend ? 'mini-day weekend' : 'mini-day'}>
                    {dayHead(day)}
                    <button
                      type="button"
                      className="mini-day-body"
                      aria-label={`${site.name}, ${day.iso}`}
                      onClick={() => setOpenDay(day.iso)}
                    >
                      {slot.here.map((entry) => (
                        <Chip key={entry.id} entry={entry} label={entry.employeeName} dimmed={isDimmed(entry)} />
                      ))}
                      {slot.elsewhere.length > 0 && (
                        <span className="mini-elsewhere">
                          {slot.elsewhere.map((entry) => (
                            <Chip
                              key={entry.id}
                              entry={entry}
                              label={`${entry.employeeName}: ${entry.type === 'Baustelle' ? entry.siteName : entry.type}`}
                              dimmed={isDimmed(entry)}
                            />
                          ))}
                        </span>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {openDay && (
        <SiteDayDialog
          site={site}
          date={openDay}
          entries={byDay.get(openDay)?.here ?? []}
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
