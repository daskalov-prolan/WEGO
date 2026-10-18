import { Alert, Group, Paper, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
 * Planning on the page of a site: the two calendar weeks from the planned start, one column per day.
 * The days show the work at this site and, below it, where the employees are elsewhere. The activities
 * still to plan are boxes on the left; a click plans them with employees and day.
 */
export function SiteMiniPlan({ site, canEdit }: Props) {
  const today = todayIso()
  const start = weekOf(site.plannedStart ?? today)[0].iso
  const weeks = [weekOf(start), weekOf(addDays(start, 7))]
  const days = weeks.flat()
  const years = [...new Set(days.map((day) => Number(day.iso.slice(0, 4))))]
  const yearsKey = years.join(',')

  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Set<Activity>>(new Set())
  const [openDay, setOpenDay] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all(yearsKey.split(',').map((year) => api.plan(Number(year)))).then(setPlans, (e) =>
      setError(messageOf(e)),
    )
  }, [yearsKey])
  useEffect(load, [load])

  const entries = useMemo(() => plans.flatMap((plan) => plan.entries), [plans])
  const employees: PlanEmployee[] = plans[0]?.employees ?? []

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

  const entriesOf = (employeeId: number, date: string) =>
    entries.filter((entry) => entry.employeeId === employeeId && entry.date === date)

  const save = async (changes: { employeeId: number; date: string; entries: ReturnType<typeof toInput>[] }[], message: string) => {
    await api.saveDays(changes)
    notifications.show({ message, color: 'green' })
    load()
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
      <Group justify="space-between" mb="xs">
        <Title order={4}>Planung</Title>
        <Text size="sm" c="dimmed">
          KW {isoWeek(days[0].iso)}–{isoWeek(days[7].iso)}
          {site.plannedStart ? ' ab geplantem Baubeginn' : ' ab heute (kein Baubeginn geplant)'}
        </Text>
      </Group>
      <ActivityLegend selected={filter} onChange={setFilter} />
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
                      load()
                    }
                  : undefined
              }
            />
          ))}
        </div>

        <div className="mini-weeks">
          {weeks.map((week) => (
            <div className="mini-week" key={week[0].iso}>
              <div className="mini-week-label">KW {isoWeek(week[0].iso)}</div>
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
