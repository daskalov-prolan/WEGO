import { Alert, Button, Group, Paper, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { Fragment, useState, type CSSProperties } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, Entry, PlanEmployee, Site } from '../api/types'
import { ACTIVITIES, activitiesOfStatus, activityLabel, allowedActivities, defaultActivity, isOpen } from '../lib/activities'
import { addDays, formatDate, isoWeek, todayIso, weekOf } from '../lib/dates'
import { moveChanges, staysPut, type DayChange, type DragItem } from '../lib/dragPlan'
import { toInput } from '../lib/ui'
import { ActivityIcon } from './ActivityIcon'
import { SiteFlow } from './ActivityPicker'
import { Chip } from './Chip'
import { LaneCell, StripGrid, StripNav } from './DayStrip'
import { percent, useDayStrip, workdaysOf } from '../lib/useDayStrip'
import type { OpenTask } from './PlanMatrix'
import { SiteDayDialog } from './SiteDayDialog'
import { TaskBox } from './TaskBox'

interface Props {
  site: Site
  canEdit: boolean
  /** The site as saved after one of its activities was cancelled or brought back. */
  onSiteChange?: (site: Site) => void
}

/**
 * Planning on the page of a site: the course of the site with the activities still to plan, below it one
 * lane per employee who can do one of them (main activity first, then additional), with the days as columns
 * that scroll sideways (about a week in view, one and a half when there is room; weekends narrow). The work
 * at this site stands out.
 */
export function SiteMiniPlan({ site, canEdit, onSiteChange }: Props) {
  const today = todayIso()
  const buildStart = weekOf(site.plannedStart ?? today)[0].iso
  const strip = useDayStrip(buildStart, site.id)
  const { visible, years, plans, entries, publicHolidays, error, reload, go } = strip
  const [openDay, setOpenDay] = useState<string | null>(null)
  const employees: PlanEmployee[] = plans[0]?.employees ?? []

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

  const setCancelled = async (activity: Activity, cancelled: boolean) => {
    const estimated = site.tasks.find((task) => task.activity === activity)?.estimatedDays ?? 1
    onSiteChange?.(await api.updateSiteTask(site.id, activity, estimated, cancelled))
    notifications.show({ message: `${activityLabel(activity)} ${cancelled ? 'storniert' : 'wieder offen'}.` })
  }

  // Who counts for how full a week is: everybody whose main activity is still to plan at this site.
  const openActivities = new Set(openTasks.map((task) => task.activity))
  const relevant = employees.filter((employee) => employee.mainActivity && openActivities.has(employee.mainActivity))
  const busy = new Set(entries.map((entry) => `${entry.employeeId}|${entry.date}`))

  /** Share of the working days (Mon–Fri, no public holidays) on which these people are planned anywhere. */
  const load = (monday: string): number | null => {
    if (relevant.length === 0) return null
    const workdays = workdaysOf(monday, publicHolidays)
    if (workdays.length === 0) return 1
    const taken = workdays.reduce((sum, iso) => sum + relevant.filter((employee) => busy.has(`${employee.id}|${iso}`)).length, 0)
    return taken / (workdays.length * relevant.length)
  }

  // Who can take one of the open activities, as main or as additional activity.
  const capable = employees.filter((employee) =>
    [employee.mainActivity, ...employee.additionalActivities].some((activity) => activity !== null && openActivities.has(activity)),
  )
  // The lanes of the calendar: first those with an open main activity, then those who can do one besides.
  const lanes = [...relevant, ...capable.filter((employee) => !relevant.includes(employee))]
  const besides = (employee: PlanEmployee) =>
    employee.additionalActivities.filter((activity) => openActivities.has(activity)).map(activityLabel)

  /** Of these, who has no entry at all on the working days (Mon–Fri, no public holidays) of a week. */
  const freeIn = (monday: string): PlanEmployee[] => {
    const workdays = workdaysOf(monday, publicHolidays)
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

  const entriesOf = (employeeId: number, date: string) =>
    entries.filter((entry) => entry.employeeId === employeeId && entry.date === date)

  const save = async (changes: DayChange[], message: string) => {
    strip.keepPosition()
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

  const fail = (e: unknown) => notifications.show({ color: 'red', message: messageOf(e) })

  /** A lane's day takes entries the employee can do and the open activities of this site they can do. */
  const accepts = (employee: PlanEmployee, date: string, item: DragItem) =>
    item.kind === 'task'
      ? item.siteId === site.id && allowedActivities(employee, site.status).includes(item.activity)
      : !staysPut(item.entry, { employeeId: employee.id, date, siteId: item.entry.siteId }) &&
        (item.entry.activity === null || allowedActivities(employee).includes(item.entry.activity))

  /** Dropped there: an entry moves to this employee and day, an open activity is planned there. */
  const dropItem = (employee: PlanEmployee, date: string, item: DragItem) => {
    if (item.kind === 'task') {
      plan(item.activity, [employee.id], date).catch(fail)
      return
    }
    const { entry } = item
    const changes = moveChanges(entry, { employeeId: employee.id, date, siteId: entry.siteId, activity: entry.activity }, entriesOf)
    save(changes, `${entry.siteName ?? entry.type} verschoben: ${employee.name}, ${formatDate(date)}.`).catch(fail)
  }

  /** An activity of the site's status in the flow: open, planned already, or cancelled for this site. */
  const step = (activity: Activity) => {
    const open = openTasks.find((task) => task.activity === activity)
    if (open)
      return (
        <TaskBox
          task={open}
          employees={employees.filter((employee) => allowedActivities(employee, site.status).includes(activity))}
          defaultDate={weekOf(visible).find((day) => !day.isWeekend && day.iso >= today)?.iso ?? visible}
          minDate={`${years[0]}-01-01`}
          maxDate={`${years[years.length - 1]}-12-31`}
          onPlan={canEdit ? (employeeIds, date) => plan(activity, employeeIds, date) : undefined}
          siteId={site.id}
          onCancel={canEdit ? () => setCancelled(activity, true) : undefined}
        />
      )
    const task = site.tasks.find((candidate) => candidate.activity === activity)
    const info = ACTIVITIES.find((candidate) => candidate.value === activity)!
    const colours = { '--entry-bg': info.tint, '--entry-strong': info.background } as CSSProperties
    // Planned already: greyed, and still to drag onto another day or person.
    if (task && !task.notNeeded && isOpen(site.status))
      return (
        <TaskBox
          planned
          task={{
            activity,
            planned: entries.filter((entry) => entry.siteId === site.id && entry.activity === activity).length,
            estimated: task.estimatedDays,
          }}
          employees={employees.filter((employee) => allowedActivities(employee, site.status).includes(activity))}
          defaultDate={weekOf(visible).find((day) => !day.isWeekend && day.iso >= today)?.iso ?? visible}
          minDate={`${years[0]}-01-01`}
          maxDate={`${years[years.length - 1]}-12-31`}
          onPlan={canEdit ? (employeeIds, date) => plan(activity, employeeIds, date) : undefined}
          siteId={site.id}
        />
      )
    if (task?.notNeeded)
      return (
        <span className="flow-step cancelled" style={colours} title="Storniert: für diese Baustelle nicht relevant">
          <ActivityIcon activity={activity} size={11} />
          <span className="task-name">{info.label}</span>
          {canEdit && (
            <button type="button" className="flow-restore" onClick={() => setCancelled(activity, false)}>
              Wiederherstellen
            </button>
          )}
        </span>
      )
    return (
      <span className="flow-step planned" style={colours} title={task ? 'Eingeplant' : 'Für diese Baustelle nicht vorgesehen'}>
        <ActivityIcon activity={activity} size={11} />
        {info.label}
        {task && ' ✓'}
      </span>
    )
  }

  return (
    <Paper withBorder p="md" mb="lg" className="mini-plan">
      <Group justify="space-between" mb="xs" gap="xs">
        <Title order={4}>Planung</Title>
        <StripNav
          strip={strip}
          today={today}
          nextFree={nextFree?.monday ?? null}
          nextFreeHint={
            capable.length === 0
              ? 'Niemand kann eine der offenen Tätigkeiten.'
              : nextFree
                ? `KW ${isoWeek(nextFree.monday)}: noch ganz frei sind ${nextFree.free.map((employee) => employee.name).join(', ')}`
                : 'In den geladenen Jahren ist niemand mehr eine ganze Woche frei, der eine offene Tätigkeit kann.'
          }
        >
          {site.plannedStart && (
            <Button size="compact-sm" variant="default" onClick={() => go(buildStart)}>
              Baubeginn
            </Button>
          )}
        </StripNav>
      </Group>
      {/* The course of the site: in its status the open activities stand out (planners drag them onto a day),
          planned ones are greyed, cancelled ones struck through. */}
      <SiteFlow current={site.status} renderStep={step} />
      {error && (
        <Alert color="red" variant="light" mt="xs">
          {error}
        </Alert>
      )}

      <StripGrid
        strip={strip}
        today={today}
        corner="Mitarbeiter"
        mark={(monday) => percent(load(monday))}
        markTitle="Auslastung der Mitarbeiter mit offener Haupttätigkeit"
      >
        {plans.length > 0 && lanes.length === 0 && (
          <Text size="sm" c="dimmed" className="mini-no-lanes">
            {openTasks.length === 0
              ? 'Alles eingeplant: keine offene Tätigkeit, für die Mitarbeiter gezeigt werden.'
              : 'Niemand kann eine der offenen Tätigkeiten.'}
          </Text>
        )}
        {lanes.map((employee) => (
          <Fragment key={employee.id}>
            {relevant.includes(employee) ? (
              <div className="mini-lane-name">
                <span className="name">{employee.name}</span>
                {employee.mainActivity && <span className="main">{activityLabel(employee.mainActivity)}</span>}
              </div>
            ) : (
              <div className="mini-lane-name besides" title="Kann eine offene Tätigkeit als Zusatztätigkeit">
                <span className="name">{employee.name}</span>
                <span className="main">auch {besides(employee).join(', ')}</span>
              </div>
            )}
            {strip.days.map((day) => (
              <LaneCell
                key={day.iso}
                day={day}
                label={`${employee.name}, ${day.iso}`}
                onOpen={() => setOpenDay(day.iso)}
                canEdit={canEdit}
                accepts={(item) => accepts(employee, day.iso, item)}
                onDropItem={(item) => dropItem(employee, day.iso, item)}
              >
                {(byLaneDay.get(`${employee.id}|${day.iso}`) ?? []).map((entry) =>
                  entry.siteId === site.id ? (
                    <span key={entry.id} className="mini-here">
                      <Chip entry={entry} label={(entry.activity && activityLabel(entry.activity)) || undefined} draggable={canEdit} />
                    </span>
                  ) : (
                    <span key={entry.id} className="mini-elsewhere">
                      <Chip entry={entry} draggable={canEdit} />
                    </span>
                  ),
                )}
              </LaneCell>
            ))}
          </Fragment>
        ))}
      </StripGrid>
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
