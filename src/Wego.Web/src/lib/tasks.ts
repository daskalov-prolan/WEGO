import type { Activity, Entry, PlanEmployee, Site } from '../api/types'
import type { OpenTask } from '../components/PlanMatrix'
import { ACTIVITIES, activitiesOfStatus, isOpen } from './activities'
import { addDays } from './dates'

/**
 * The activities each open site still needs in its status: not cancelled for the site and planned on fewer
 * employee days than expected (counted over the given entries).
 */
export function openTasksBySite(sites: Site[], entries: Entry[]): Map<number, OpenTask[]> {
  const result = new Map<number, OpenTask[]>()
  const planned = new Map<string, number>()
  for (const entry of entries) {
    if (entry.siteId === null || !entry.activity) continue
    const key = `${entry.siteId}|${entry.activity}`
    planned.set(key, (planned.get(key) ?? 0) + 1)
  }
  for (const site of sites) {
    if (!isOpen(site.status)) continue
    const ofStatus = activitiesOfStatus(site.status)
    const tasks = site.tasks
      .filter((task) => ofStatus.includes(task.activity) && !task.notNeeded)
      .map((task) => ({
        activity: task.activity,
        planned: planned.get(`${site.id}|${task.activity}`) ?? 0,
        estimated: task.estimatedDays,
      }))
      .filter((task) => task.planned < task.estimated)
    if (tasks.length > 0) result.set(site.id, tasks)
  }
  return result
}

/**
 * Every open task an employee can do: those of the main activity first, then those of the additional
 * activities (in the order of the job); within each activity the earliest planned start first, sites
 * without a date last. `keepActivity` and `keepSite` narrow the list (e.g. the filters of the plan).
 */
export function tasksForEmployee(
  employee: PlanEmployee,
  open: Map<number, OpenTask[]>,
  siteById: Map<number, Site>,
  keepActivity: (activity: Activity) => boolean = () => true,
  keepSite: (site: Site) => boolean = () => true,
): { site: Site; task: OpenTask }[] {
  const additional = ACTIVITIES.map((activity) => activity.value).filter((activity) => employee.additionalActivities.includes(activity))
  const activities = [...new Set([employee.mainActivity, ...additional])].filter(
    (activity): activity is Activity => activity !== null && keepActivity(activity),
  )
  const result: { site: Site; task: OpenTask }[] = []
  for (const activity of activities) {
    const ofActivity: { site: Site; task: OpenTask }[] = []
    for (const [siteId, tasks] of open) {
      const site = siteById.get(siteId)
      const task = tasks.find((candidate) => candidate.activity === activity)
      if (site && task && keepSite(site)) ofActivity.push({ site, task })
    }
    ofActivity.sort(
      (a, b) =>
        (a.site.plannedStart ?? '9999').localeCompare(b.site.plannedStart ?? '9999') || a.site.name.localeCompare(b.site.name, 'de'),
    )
    result.push(...ofActivity)
  }
  return result
}

/** A stretch of work: the same site and activity on working days one after the other. */
export interface WorkRun {
  first: Entry
  from: string
  to: string
}

/**
 * The entries of one employee at sites, in the order of the days, joined to stretches: the same site and
 * activity on following days (a weekend in between does not break it).
 */
export function workRuns(entries: Entry[]): WorkRun[] {
  const runs: WorkRun[] = []
  const sorted = entries.filter((entry) => entry.siteId !== null).sort((a, b) => a.date.localeCompare(b.date))
  for (const entry of sorted) {
    const run = runs.findLast((candidate) => candidate.first.siteId === entry.siteId && candidate.first.activity === entry.activity)
    // A second site on the same day does not break the stretch of the first one.
    if (run && onlyWeekendBetween(run.to, entry.date)) {
      if (entry.date > run.to) run.to = entry.date
      continue
    }
    runs.push({ first: entry, from: entry.date, to: entry.date })
  }
  return runs
}

function onlyWeekendBetween(from: string, to: string): boolean {
  if (to <= from) return true
  for (let iso = addDays(from, 1); iso < to; iso = addDays(iso, 1)) {
    const weekday = new Date(`${iso}T12:00:00`).getDay()
    if (weekday !== 0 && weekday !== 6) return false
  }
  return true
}
