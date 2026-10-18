import type { CSSProperties } from 'react'
import type { Site } from '../api/types'
import { ACTIVITIES, activitiesOfStatus, isOpen } from '../lib/activities'
import { ActivityIcon } from './ActivityIcon'
import type { OpenTask } from './PlanMatrix'

/**
 * The activities of a site's status one after the other: those still to plan stand out, planned ones are
 * greyed, cancelled ones struck through. Done and cancelled sites show none.
 */
export function SiteActivities({ site, open }: { site: Site; open: OpenTask[] }) {
  if (!isOpen(site.status)) return null
  const ofStatus = activitiesOfStatus(site.status)
  return (
    <span className="site-activities">
      {ACTIVITIES.filter((activity) => ofStatus.includes(activity.value)).map((activity) => {
        const task = site.tasks.find((candidate) => candidate.activity === activity.value)
        const state = task?.notNeeded ? 'cancelled' : open.some((candidate) => candidate.activity === activity.value) ? 'open' : 'planned'
        return (
          <span
            key={activity.value}
            className={`flow-step ${state}`}
            style={{ '--entry-bg': activity.tint, '--entry-strong': activity.background } as CSSProperties}
            title={state === 'open' ? 'Noch nicht eingeplant' : state === 'cancelled' ? 'Storniert' : 'Eingeplant'}
            data-state={state}
          >
            <ActivityIcon activity={activity.value} size={11} />
            <span className="task-name">{activity.label}</span>
          </span>
        )
      })}
    </span>
  )
}
