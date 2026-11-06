import { Alert, Button, Group, Paper, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { Fragment, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, Entry, PlanEmployee, Site } from '../api/types'
import {
  activityLabel,
  allowedActivities,
  defaultActivity,
  entryName,
  entryTitle,
  isOpen,
} from '../lib/activities'
import { addDays, formatDate, isoWeek, todayIso, weekOf, type Day } from '../lib/dates'
import { moveChanges, staysPut, type DayChange, type DragItem } from '../lib/dragPlan'
import { onDay, toInput } from '../lib/ui'
import { Chip } from './Chip'
import { LaneCell, StripGrid, StripNav } from './DayStrip'
import { useDayStrip, workdaysOf } from '../lib/useDayStrip'
import { SiteDayDialog } from './SiteDayDialog'

interface Props {
  site: Site
  canEdit: boolean
}

/**
 * Planning on the page of a site: one lane per employee who works there, with the days as columns
 * that scroll sideways (about a week in view, one and a half when there is room; weekends narrow). The work
 * at this site stands out.
 */
export function SiteMiniPlan({ site, canEdit }: Props) {
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

  // The lanes of the calendar: only what concerns this site, i.e. who works here.
  const workedHere = new Set(entries.filter((entry) => entry.siteId === site.id).map((entry) => entry.employeeId))
  const lanes = employees.filter((employee) => workedHere.has(employee.id))

  // Who may be free for the site: everybody who works on sites, and the days they are taken anywhere.
  const capable = employees.filter((employee) => allowedActivities(employee, site.status).length > 0)
  const busy = new Set(entries.map((entry) => `${entry.employeeId}|${entry.date}`))

  /** Of them, who has no entry at all on the working days (Mon–Fri, no public holidays) of a week. */
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
          onDay(
            {
              type: 'Baustelle' as const,
              siteId: site.id,
              activity: activity ?? defaultActivity(employee, site.status),
              startTime: null,
              endTime: null,
              note: null,
              noteImportant: false,
            },
            entriesOf(employeeId, date),
          ),
        ],
      }
    })
    const what = activity ? activityLabel(activity) : `${changes.length} Mitarbeiter`
    await save(changes, `${what} am ${date.slice(8, 10)}.${date.slice(5, 7)}. eingeplant.`)
  }

  const fail = (e: unknown) => notifications.show({ color: 'red', message: messageOf(e) })

  /** A lane's day takes entries the employee can do. */
  const accepts = (employee: PlanEmployee, date: string, item: DragItem) =>
    item.kind !== 'entry'
      ? false
      : !staysPut(item.entry, { employeeId: employee.id, date, siteId: item.entry.siteId }) &&
        (item.entry.activity === null || allowedActivities(employee).includes(item.entry.activity))

  /** Dropped there: an entry moves to this employee and day. */
  const dropItem = (employee: PlanEmployee, date: string, item: DragItem) => {
    if (item.kind !== 'entry') return
    const { entry } = item
    const changes = moveChanges(entry, { employeeId: employee.id, date, siteId: entry.siteId, activity: entry.activity }, entriesOf)
    save(changes, `${entryName(entry)} verschoben: ${employee.name}, ${formatDate(date)}.`).catch(fail)
  }

  // A working day where nothing happens at this site and everybody shown works elsewhere is of no interest
  // here: it gets a narrow column, so that a longer stretch fits. A day with someone free stays wide.
  const notHere = (day: Day) =>
    lanes.length > 0 &&
    lanes.every((employee) => {
      const there = byLaneDay.get(`${employee.id}|${day.iso}`) ?? []
      return there.length > 0 && there.every((entry) => entry.siteId !== site.id)
    })

  return (
    <Paper withBorder p="md" mb="lg" className="mini-plan">
      <Group justify="space-between" mb="xs" gap="xs">
        <Title order={4}>Planung</Title>
        <StripNav
          strip={strip}
          today={today}
          nextFree={nextFree?.monday ?? null}
          nextFreeHint={
            nextFree
              ? `KW ${isoWeek(nextFree.monday)}: noch ganz frei sind ${nextFree.free.map((employee) => employee.name).join(', ')}`
              : 'In den geladenen Jahren ist niemand mehr eine ganze Woche frei.'
          }
        >
          {site.plannedStart && (
            <Button size="compact-sm" variant="default" onClick={() => go(buildStart)}>
              Baubeginn
            </Button>
          )}
        </StripNav>
      </Group>
      {error && (
        <Alert color="red" variant="light" mt="xs">
          {error}
        </Alert>
      )}

      <StripGrid
        strip={strip}
        today={today}
        corner="Mitarbeiter"
        narrow={notHere}
      >
        {plans.length > 0 && lanes.length === 0 && (
          <Text size="sm" c="dimmed" className="mini-no-lanes">
            Noch niemand auf dieser Baustelle eingesetzt.
          </Text>
        )}
        {lanes.map((employee) => (
          <Fragment key={employee.id}>
            <div className="mini-lane-name">
              <span className="name">{employee.name}</span>
            </div>
            {strip.days.map((day) => (
              <LaneCell
                key={day.iso}
                day={day}
                label={`${employee.name}, ${day.iso}`}
                onOpen={() => setOpenDay(day.iso)}
                canEdit={canEdit}
                accepts={(item) => accepts(employee, day.iso, item)}
                onDropItem={(item) => dropItem(employee, day.iso, item)}
                narrow={!day.isWeekend && notHere(day)}
              >
                {(byLaneDay.get(`${employee.id}|${day.iso}`) ?? []).map((entry) =>
                  entry.siteId === site.id ? (
                    <span key={entry.id} className="mini-here">
                      <Chip entry={entry} label={(entry.activity && activityLabel(entry.activity)) || undefined} draggable={canEdit} />
                    </span>
                  ) : (
                    // Work elsewhere only shows that the day is taken.
                    <span key={entry.id} className="mini-elsewhere mini-busy" title={entryTitle(entry)}>
                      {entry.type === 'Baustelle' ? 'belegt' : entry.type}
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
