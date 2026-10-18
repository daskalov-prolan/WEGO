import { Alert, Group, Paper, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, DayEntryInput, NamedItem, Site } from '../api/types'
import { activityLabel, allowedActivities } from '../lib/activities'
import { addDays, formatDate, isoWeek, todayIso, weekOf } from '../lib/dates'
import { moveChanges, staysPut, type DayChange, type DragItem } from '../lib/dragPlan'
import { openTasksBySite, tasksForEmployee } from '../lib/tasks'
import { toInput } from '../lib/ui'
import { percent, useDayStrip, workdaysOf } from '../lib/useDayStrip'
import { Chip } from './Chip'
import { DayEditor } from './DayEditor'
import { LaneCell, StripGrid, StripNav } from './DayStrip'
import { TaskBox } from './TaskBox'

interface Props {
  employeeId: number
  canEdit: boolean
}

/** How many open tasks are shown before "+ N weitere". */
const FIRST_TASKS = 12

/**
 * Planning on the page of an employee: the open activities of the sites that the employee can do (main
 * activity first, then additional ones), and the employee's days as columns that scroll sideways. Planners
 * drag an open activity onto a day to plan it, or an entry onto another day to move it.
 */
export function EmployeeMiniPlan({ employeeId, canEdit }: Props) {
  const today = todayIso()
  const strip = useDayStrip(weekOf(today)[0].iso)
  const { visible, years, plans, entries, publicHolidays, error, reload } = strip
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [allTasks, setAllTasks] = useState(false)

  const employee = plans[0]?.employees.find((candidate) => candidate.id === employeeId)
  const sites: Site[] = plans[0]?.sites ?? []
  const siteById = new Map(sites.map((site) => [site.id, site]))
  const tasks = employee ? tasksForEmployee(employee, openTasksBySite(sites, entries), siteById) : []
  const shown = allTasks ? tasks : tasks.slice(0, FIRST_TASKS)
  const mainCount = tasks.filter(({ task }) => task.activity === employee?.mainActivity).length

  const own = entries.filter((entry) => entry.employeeId === employeeId)
  const entriesOn = (date: string) => own.filter((entry) => entry.date === date)
  const busy = new Set(own.map((entry) => entry.date))

  /** Share of the working days (Mon–Fri, no public holidays) of a week on which the employee has an entry. */
  const load = (monday: string): number => {
    const workdays = workdaysOf(monday, publicHolidays)
    return workdays.length === 0 ? 1 : workdays.filter((iso) => busy.has(iso)).length / workdays.length
  }

  /** The next week after the first one in view without any entry on a working day; within the loaded years. */
  const nextFree = (() => {
    const lastDay = `${years[years.length - 1]}-12-31`
    for (let monday = addDays(visible, 7); monday <= lastDay; monday = addDays(monday, 7)) {
      const workdays = workdaysOf(monday, publicHolidays)
      if (workdays.length > 0 && workdays.every((iso) => !busy.has(iso))) return monday
    }
    return null
  })()

  // Sites of the weeks around the one in view: offered as one-tap buttons in the day editor.
  const recentSites: NamedItem[] = [
    ...new Map(
      own
        .filter((entry) => entry.siteId !== null && entry.date >= addDays(visible, -7) && entry.date <= addDays(visible, 20))
        .map((entry) => [entry.siteId!, { id: entry.siteId!, name: entry.siteName ?? '' }]),
    ).values(),
  ]

  const fail = (e: unknown) => notifications.show({ color: 'red', message: messageOf(e) })

  const save = async (changes: DayChange[], message: string) => {
    strip.keepPosition()
    await api.saveDays(changes)
    notifications.show({ message, color: 'green' })
    reload()
  }

  /** Puts an open activity of a site on the employee on that day, next to what is planned there already. */
  const planTask = async (site: Site, activity: Activity, date: string) => {
    const entry: DayEntryInput = {
      type: 'Baustelle',
      siteId: site.id,
      activity,
      startTime: null,
      endTime: null,
      note: null,
      noteImportant: false,
    }
    await save(
      [{ employeeId, date, entries: [...entriesOn(date).map(toInput), entry] }],
      `${activityLabel(activity)} auf ${site.name} am ${formatDate(date)} eingeplant.`,
    )
  }

  const cancelTask = async (site: Site, activity: Activity) => {
    const estimated = site.tasks.find((task) => task.activity === activity)?.estimatedDays ?? 1
    await api.updateSiteTask(site.id, activity, estimated, true)
    notifications.show({ message: `${activityLabel(activity)} auf ${site.name} storniert.` })
    reload()
  }

  /** A day takes the open activities the employee can do, and the employee's entries from other days. */
  const accepts = (date: string, item: DragItem) => {
    if (!employee) return false
    if (item.kind === 'task') {
      const site = siteById.get(item.siteId)
      return site !== undefined && allowedActivities(employee, site.status).includes(item.activity)
    }
    return (
      !staysPut(item.entry, { employeeId, date, siteId: item.entry.siteId }) &&
      (item.entry.activity === null || allowedActivities(employee).includes(item.entry.activity))
    )
  }

  const dropItem = (date: string, item: DragItem) => {
    if (item.kind === 'task') {
      const site = siteById.get(item.siteId)
      if (site) planTask(site, item.activity, date).catch(fail)
      return
    }
    const { entry } = item
    const changes = moveChanges(entry, { employeeId, date, siteId: entry.siteId, activity: entry.activity }, (id, iso) =>
      entries.filter((other) => other.employeeId === id && other.date === iso),
    )
    save(changes, `${entry.siteName ?? entry.type} verschoben: ${formatDate(date)}.`).catch(fail)
  }

  return (
    <Paper withBorder p="md" mb="lg" className="mini-plan employee-plan">
      <Group justify="space-between" mb="xs" gap="xs">
        <Title order={4}>Planung</Title>
        <StripNav
          strip={strip}
          today={today}
          nextFree={nextFree}
          nextFreeHint={
            nextFree
              ? `KW ${isoWeek(nextFree)}: noch kein einziger Termin.`
              : 'In den geladenen Jahren ist keine ganze Woche mehr frei.'
          }
        />
      </Group>
      {error && (
        <Alert color="red" variant="light" mt="xs">
          {error}
        </Alert>
      )}
      {plans.length > 0 && !employee && (
        <Text size="sm" c="dimmed">
          Dieser Mitarbeiter ist nicht in der Planung (inaktiv?).
        </Text>
      )}

      {employee && (
        <>
          <div className="employee-tasks" role="group" aria-label="Ungeplante Tätigkeiten">
            <Text size="xs" fw={700} c="dimmed">
              Ungeplant:
            </Text>
            {tasks.length === 0 && (
              <Text size="xs" c="dimmed">
                keine offene Tätigkeit, die {employee.name} kann
              </Text>
            )}
            {shown.map(({ site, task }, index) => (
              <span key={`${site.id}|${task.activity}`} className="employee-task">
                {/* After the main activity: the open tasks of the additional activities. */}
                {index === mainCount && index > 0 && <span className="employee-tasks-besides">auch:</span>}
                <TaskBox
                  task={task}
                  label={site.name}
                  employees={[employee]}
                  employee={employee}
                  defaultDate={weekOf(visible).find((day) => !day.isWeekend && day.iso >= today)?.iso ?? visible}
                  minDate={`${years[0]}-01-01`}
                  maxDate={`${years[years.length - 1]}-12-31`}
                  onPlan={canEdit ? (_, date) => planTask(site, task.activity, date) : undefined}
                  onCancel={canEdit ? () => cancelTask(site, task.activity) : undefined}
                  siteId={site.id}
                />
              </span>
            ))}
            {tasks.length > FIRST_TASKS && (
              <button type="button" className="task-more" onClick={() => setAllTasks((value) => !value)}>
                {allTasks ? 'weniger' : `+ ${tasks.length - FIRST_TASKS} weitere`}
              </button>
            )}
          </div>

          <StripGrid
            strip={strip}
            today={today}
            corner="Mitarbeiter"
            mark={(monday) => percent(load(monday))}
            markTitle="Anteil der Arbeitstage mit Termin"
          >
            <div className="mini-lane-name">
              <span className="name">{employee.name}</span>
              {employee.mainActivity && <span className="main">{activityLabel(employee.mainActivity)}</span>}
            </div>
            {strip.days.map((day) => (
              <LaneCell
                key={day.iso}
                day={day}
                label={`${employee.name}, ${day.iso}`}
                onOpen={() => canEdit && setOpenDay(day.iso)}
                canEdit={canEdit}
                accepts={(item) => accepts(day.iso, item)}
                onDropItem={(item) => dropItem(day.iso, item)}
              >
                {entriesOn(day.iso).map((entry) => (
                  <Chip key={entry.id} entry={entry} draggable={canEdit} />
                ))}
              </LaneCell>
            ))}
          </StripGrid>
        </>
      )}

      {openDay && employee && (
        <DayEditor
          key={openDay}
          employee={employee}
          date={openDay}
          entries={entriesOn(openDay)}
          sites={sites}
          onCreateSite={async (input) => {
            const site = await api.createSite(input)
            reload()
            return site
          }}
          onUpdateSite={async (id, input) => {
            const site = await api.updateSite(id, input)
            reload()
            return site
          }}
          recentSites={recentSites}
          onClose={() => setOpenDay(null)}
          onSave={async (dayEntries) => {
            await save([{ employeeId, date: openDay, entries: dayEntries }], `${employee.name}: Tag gespeichert.`)
            setOpenDay(null)
          }}
        />
      )}
    </Paper>
  )
}
