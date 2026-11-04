import { Badge, Group } from '@mantine/core'
import type { Activity } from '../api/types'
import { ACTIVITIES, activityLabel } from '../lib/activities'
import { ActivityIcon } from './ActivityIcon'

const colourOf = (activity: Activity) => ACTIVITIES.find((a) => a.value === activity)!.background
const tintOf = (activity: Activity) => ACTIVITIES.find((a) => a.value === activity)!.tint

interface Skills {
  mainActivity: Activity | null
  additionalActivities: Activity[]
}

/**
 * The main activity first, in its full colour and stressed; the additional ones light in their colour; each
 * with the sign of its activity. With `onToggle` they are filters: chosen ones are pressed, the others fade.
 */
export function ActivityBadges({
  mainActivity,
  additionalActivities,
  selected,
  onToggle,
}: Skills & { selected?: Set<Activity>; onToggle?: (activity: Activity) => void }) {
  const filtering = selected !== undefined && selected.size > 0
  const filterProps = (activity: Activity) =>
    onToggle
      ? {
          component: 'button' as const,
          type: 'button' as const,
          'aria-pressed': selected?.has(activity) ?? false,
          onClick: () => onToggle(activity),
          className: filtering && !selected?.has(activity) ? 'skill-badge filter off' : 'skill-badge filter',
        }
      : { className: 'skill-badge' }
  return (
    <Group gap={4}>
      {mainActivity && (
        <Badge
          variant="filled"
          title={onToggle ? 'Haupttätigkeit – filtert die Planung' : 'Haupttätigkeit'}
          styles={{ root: { background: colourOf(mainActivity), color: '#1b1b1b', boxShadow: `0 0 0 2px #fff, 0 0 0 3.5px ${colourOf(mainActivity)}` } }}
          leftSection={<ActivityIcon activity={mainActivity} size={11} />}
          {...filterProps(mainActivity)}
        >
          {activityLabel(mainActivity)}
        </Badge>
      )}
      {additionalActivities.map((activity) => (
        <Badge
          key={activity}
          variant="light"
          title={onToggle ? 'Weitere Tätigkeit – filtert die Planung' : 'Weitere Tätigkeit'}
          styles={{ root: { background: tintOf(activity), color: '#14232a', border: `1px solid ${colourOf(activity)}` } }}
          leftSection={<ActivityIcon activity={activity} size={11} />}
          {...filterProps(activity)}
        >
          {activityLabel(activity)}
        </Badge>
      ))}
    </Group>
  )
}
