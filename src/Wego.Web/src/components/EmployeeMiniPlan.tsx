import { Alert, Group, Paper, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { Fragment, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, Entry, Site } from '../api/types'
import { allowedActivities, defaultActivity, entryName, isOpen } from '../lib/activities'
import { addDays, formatDate, isoWeek, todayIso, weekOf } from '../lib/dates'
import { moveChanges, staysPut, type DayChange, type DragItem } from '../lib/dragPlan'
import { useDayStrip, workdaysOf } from '../lib/useDayStrip'
import { Chip } from './Chip'
import { DayEditor } from './DayEditor'
import { LaneCell, StripGrid, StripNav } from './DayStrip'

interface Props {
  employeeId: number
  canEdit: boolean
  /** Only these activities: other entries fade, sites without them drop out. Empty: all. */
  activityFilter?: Set<Activity>
}

/** How many sites get a lane before "+ N weitere Baustellen". */
const FIRST_LANES = 12
const NO_FILTER = new Set<Activity>()

/**
 * Planning on the page of an employee: one lane per site, the days as columns that scroll sideways: the sites
 * the employee works on in the two weeks from the one in view (in the order of the work). Planners drag an
 * entry onto another day or site.
 * Colleagues on the same site and day are shown faintly. Vacation and sick days get a lane of their own.
 */
export function EmployeeMiniPlan({ employeeId, canEdit, activityFilter = NO_FILTER }: Props) {
  const fits = (activity: Activity | null) => activityFilter.size === 0 || (activity !== null && activityFilter.has(activity))
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
  const absences = own.filter((entry) => entry.siteId === null && entry.date >= visible && entry.date <= addDays(visible, 13))

  // The lanes: sites worked on in the two weeks from the one in view, in the order of the work. Scrolling to
  // other weeks brings their sites up.
  const lanes: { site: Site }[] = []
  const inView = { from: visible, to: addDays(visible, 13) }
  for (const entry of [...own].sort((a, b) => a.date.localeCompare(b.date))) {
    if (entry.siteId === null || entry.date < inView.from || entry.date > inView.to || !fits(entry.activity)) continue
    const site = siteById.get(entry.siteId)
    if (site && !lanes.some((lane) => lane.site.id === site.id)) lanes.push({ site })
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

  /** The next week after the first one in view without any entry on a working day; within the loaded years. */
  const nextFree = (() => {
    const lastDay = `${years[years.length - 1]}-12-31`
    for (let monday = addDays(visible, 7); monday <= lastDay; monday = addDays(monday, 7)) {
      const workdays = workdaysOf(monday, publicHolidays)
      if (workdays.length > 0 && workdays.every((iso) => !busy.has(iso))) return monday
    }
    return null
  })()

  const fail = (e: unknown) => notifications.show({ color: 'red', message: messageOf(e) })

  const save = async (changes: DayChange[], message: string) => {
    strip.keepPosition()
    await api.saveDays(changes)
    notifications.show({ message, color: 'green' })
    reload()
  }

  const entriesOf = (id: number, iso: string) => entries.filter((other) => other.employeeId === id && other.date === iso)

  /** A site's day takes the employee's site entries. */
  const acceptsOnSite = (site: Site, date: string, item: DragItem) => {
    if (!employee || item.kind !== 'entry') return false
    const { entry } = item
    return (
      entry.employeeId === employeeId &&
      entry.type === 'Baustelle' &&
      !staysPut(entry, { employeeId, date, siteId: site.id }) &&
      (entry.siteId === site.id || isOpen(site.status))
    )
  }

  const dropOnSite = (site: Site, date: string, item: DragItem) => {
    if (!employee || item.kind !== 'entry') return
    const { entry } = item
    // The activity stays if it fits the site, else the employee's own one there.
    const activity =
      entry.activity && (entry.siteId === site.id || allowedActivities(employee, site.status).includes(entry.activity))
        ? entry.activity
        : defaultActivity(employee, site.status)
    const changes = moveChanges(entry, { employeeId, date, siteId: site.id, activity }, entriesOf)
    save(changes, `${entryName(entry)} verschoben: ${site.name}, ${formatDate(date)}.`).catch(fail)
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
          corner="Baustelle"
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
              Keine Einsätze in diesen Wochen.
            </Text>
          )}
          {shownLanes.map(({ site }) => (
            <Fragment key={site.id}>
              <div className="mini-lane-name site-lane">
                <a className="name" href={`#/baustellen/${site.id}`} title={site.name}>
                  {site.name}
                </a>
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
                        <Chip
                          entry={entry}
                          // The name, as for the colleagues; the colour tells the activity.
                          label={entry.employeeName}
                          draggable={canEdit}
                          dimmed={!fits(entry.activity)}
                        />
                      </span>
                    ) : (
                      // Colleagues on the same site that day: with whom.
                      <span key={entry.id} className="mini-elsewhere">
                        <Chip entry={entry} label={entry.employeeName} dimmed={!fits(entry.activity)} />
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
          // Only Planer G open the report of an employee.
          canAbsence
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
