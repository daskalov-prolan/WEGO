import { Alert, Group, Paper, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { Fragment, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, DayEntryInput, Entry, NamedItem, Site } from '../api/types'
import { activityLabel, allowedActivities, defaultActivity, isOpen } from '../lib/activities'
import { addDays, formatDate, isoWeek, todayIso, weekOf } from '../lib/dates'
import { moveChanges, staysPut, type DayChange, type DragItem } from '../lib/dragPlan'
import { openTasksBySite, tasksForEmployee } from '../lib/tasks'
import { toInput } from '../lib/ui'
import { percent, useDayStrip, workdaysOf } from '../lib/useDayStrip'
import { Chip } from './Chip'
import { DayEditor } from './DayEditor'
import { LaneCell, StripGrid, StripNav } from './DayStrip'
import type { OpenTask } from './PlanMatrix'
import { TaskBox } from './TaskBox'

interface Props {
  employeeId: number
  canEdit: boolean
}

/** How many sites get a lane before "+ N weitere Baustellen". */
const FIRST_LANES = 12

/**
 * Planning on the page of an employee: one lane per site, the days as columns that scroll sideways. First
 * the sites the employee works on in the two weeks from the one in view (in the order of the work), then those with open
 * activities the employee can do (main activity first, each by planned start). The open activities stand at
 * the site's name; planners drag them onto a day of that lane, or an entry onto another day or site.
 * Colleagues on the same site and day are shown faintly. Vacation and sick days get a lane of their own.
 */
export function EmployeeMiniPlan({ employeeId, canEdit }: Props) {
  const today = todayIso()
  const strip = useDayStrip(weekOf(today)[0].iso)
  const { visible, years, days, plans, entries, publicHolidays, error, reload } = strip
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [allLanes, setAllLanes] = useState(false)

  const employee = plans[0]?.employees.find((candidate) => candidate.id === employeeId)
  const sites: Site[] = plans[0]?.sites ?? []
  const siteById = new Map(sites.map((site) => [site.id, site]))

  const own = entries.filter((entry) => entry.employeeId === employeeId)
  const entriesOn = (date: string) => own.filter((entry) => entry.date === date)
  const busy = new Set(own.map((entry) => entry.date))
  const first = days[0]?.iso ?? visible
  const last = days[days.length - 1]?.iso ?? visible
  const absences = own.filter((entry) => entry.siteId === null && entry.date >= first && entry.date <= last)

  // The lanes: sites worked on in the two weeks from the one in view, in the order of the work; then those
  // with open tasks. Scrolling to other weeks brings their sites up.
  const lanes: { site: Site; tasks: OpenTask[] }[] = []
  const inView = { from: visible, to: addDays(visible, 13) }
  for (const entry of [...own].sort((a, b) => a.date.localeCompare(b.date))) {
    if (entry.siteId === null || entry.date < inView.from || entry.date > inView.to) continue
    const site = siteById.get(entry.siteId)
    if (site && !lanes.some((lane) => lane.site.id === site.id)) lanes.push({ site, tasks: [] })
  }
  const tasks = employee ? tasksForEmployee(employee, openTasksBySite(sites, entries), siteById) : []
  for (const { site, task } of tasks) {
    const lane = lanes.find((candidate) => candidate.site.id === site.id)
    if (lane) lane.tasks.push(task)
    else lanes.push({ site, tasks: [task] })
  }
  const shownLanes = allLanes ? lanes : lanes.slice(0, FIRST_LANES)

  // Everybody's entries per site and day: the employee's own first, then colleagues.
  const atSite = new Map<string, Entry[]>()
  for (const entry of entries) {
    if (entry.siteId === null) continue
    const key = `${entry.siteId}|${entry.date}`
    atSite.set(key, [...(atSite.get(key) ?? []), entry])
  }
  for (const list of atSite.values()) list.sort((a, b) => Number(b.employeeId === employeeId) - Number(a.employeeId === employeeId))

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

  const entriesOf = (id: number, iso: string) => entries.filter((other) => other.employeeId === id && other.date === iso)

  /** A site's day takes the open activities of that site the employee can do, and the employee's site entries. */
  const acceptsOnSite = (site: Site, date: string, item: DragItem) => {
    if (!employee) return false
    if (item.kind === 'task') return item.siteId === site.id && allowedActivities(employee, site.status).includes(item.activity)
    const { entry } = item
    return (
      entry.employeeId === employeeId &&
      entry.type === 'Baustelle' &&
      !staysPut(entry, { employeeId, date, siteId: site.id }) &&
      (entry.siteId === site.id || isOpen(site.status))
    )
  }

  const dropOnSite = (site: Site, date: string, item: DragItem) => {
    if (!employee) return
    if (item.kind === 'task') {
      planTask(site, item.activity, date).catch(fail)
      return
    }
    const { entry } = item
    // The activity stays if it fits the site, else the employee's own one there.
    const activity =
      entry.activity && (entry.siteId === site.id || allowedActivities(employee, site.status).includes(entry.activity))
        ? entry.activity
        : defaultActivity(employee, site.status)
    const changes = moveChanges(entry, { employeeId, date, siteId: site.id, activity }, entriesOf)
    save(changes, `${entry.siteName ?? entry.type} verschoben: ${site.name}, ${formatDate(date)}.`).catch(fail)
  }

  /** The lane of absences takes vacation and sick days of the employee, moved to another day. */
  const acceptsAbsence = (date: string, item: DragItem) =>
    item.kind === 'entry' &&
    item.entry.employeeId === employeeId &&
    item.entry.siteId === null &&
    !staysPut(item.entry, { employeeId, date, siteId: null })

  const dropAbsence = (date: string, item: DragItem) => {
    if (item.kind !== 'entry') return
    const changes = moveChanges(item.entry, { employeeId, date, siteId: null, activity: null }, entriesOf)
    save(changes, `${item.entry.type} verschoben: ${formatDate(date)}.`).catch(fail)
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
            nextFree ? `KW ${isoWeek(nextFree)}: noch kein einziger Termin.` : 'In den geladenen Jahren ist keine ganze Woche mehr frei.'
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
        <StripGrid
          strip={strip}
          today={today}
          corner="Baustelle · offen"
          mark={(monday) => percent(load(monday))}
          markTitle={`Anteil der Arbeitstage mit Termin von ${employee.name}`}
        >
          {absences.length > 0 && (
            <>
              <div className="mini-lane-name">
                <span className="name">Urlaub / Krank</span>
              </div>
              {days.map((day) => (
                <LaneCell
                  key={day.iso}
                  day={day}
                  label={`Urlaub / Krank, ${day.iso}`}
                  onOpen={() => canEdit && setOpenDay(day.iso)}
                  canEdit={canEdit}
                  accepts={(item) => acceptsAbsence(day.iso, item)}
                  onDropItem={(item) => dropAbsence(day.iso, item)}
                >
                  {entriesOn(day.iso)
                    .filter((entry) => entry.siteId === null)
                    .map((entry) => (
                      <span key={entry.id} className="mini-here">
                        <Chip entry={entry} draggable={canEdit} />
                      </span>
                    ))}
                </LaneCell>
              ))}
            </>
          )}
          {plans.length > 0 && lanes.length === 0 && (
            <Text size="sm" c="dimmed" className="mini-no-lanes">
              Keine Einsätze in diesen Wochen und keine offene Tätigkeit, die {employee.name} kann.
            </Text>
          )}
          {shownLanes.map(({ site, tasks: open }) => (
            <Fragment key={site.id}>
              <div className="mini-lane-name site-lane">
                <a className="name" href={`#/baustellen/${site.id}`} title={site.name}>
                  {site.name}
                </a>
                {open.map((task) => (
                  <TaskBox
                    key={task.activity}
                    task={task}
                    employees={[employee]}
                    employee={employee}
                    defaultDate={weekOf(visible).find((day) => !day.isWeekend && day.iso >= today)?.iso ?? visible}
                    minDate={`${years[0]}-01-01`}
                    maxDate={`${years[years.length - 1]}-12-31`}
                    onPlan={canEdit ? (_, date) => planTask(site, task.activity, date) : undefined}
                    onCancel={canEdit ? () => cancelTask(site, task.activity) : undefined}
                    siteId={site.id}
                  />
                ))}
              </div>
              {days.map((day) => (
                <LaneCell
                  key={day.iso}
                  day={day}
                  label={`${site.name}, ${day.iso}`}
                  onOpen={() => canEdit && setOpenDay(day.iso)}
                  canEdit={canEdit}
                  accepts={(item) => acceptsOnSite(site, day.iso, item)}
                  onDropItem={(item) => dropOnSite(site, day.iso, item)}
                >
                  {(atSite.get(`${site.id}|${day.iso}`) ?? []).map((entry) =>
                    entry.employeeId === employeeId ? (
                      <span key={entry.id} className="mini-here">
                        <Chip entry={entry} label={(entry.activity && activityLabel(entry.activity)) || undefined} draggable={canEdit} />
                      </span>
                    ) : (
                      // Colleagues on the same site that day: with whom.
                      <span key={entry.id} className="mini-elsewhere">
                        <Chip entry={entry} label={entry.employeeName} />
                      </span>
                    ),
                  )}
                </LaneCell>
              ))}
            </Fragment>
          ))}
        </StripGrid>
      )}
      {lanes.length > FIRST_LANES && (
        <button type="button" className="task-more" onClick={() => setAllLanes((value) => !value)}>
          {allLanes ? 'weniger Baustellen' : `+ ${lanes.length - FIRST_LANES} weitere Baustellen`}
        </button>
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
