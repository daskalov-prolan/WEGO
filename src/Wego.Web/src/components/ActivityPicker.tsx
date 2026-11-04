import { ColorSwatch, Group, Select } from '@mantine/core'
import type { CSSProperties } from 'react'
import type { Activity, SiteStatus } from '../api/types'
import { ActivityIcon } from './ActivityIcon'
import { ACTIVITIES, activityInfo, SITE_STATUSES, textOn } from '../lib/activities'
import { dragSource } from '../lib/dragPlan'

/** Choice of the activity on the site, each with its colour from the plan. */
export function ActivitySelect({
  value,
  onChange,
  allowed,
  main = null,
  label = 'Tätigkeit',
}: {
  value: Activity | null
  onChange: (value: Activity | null) => void
  /** Only these are offered (an employee's main and additional activities); default: all. */
  allowed?: Activity[]
  main?: Activity | null
  label?: string
}) {
  const selected = value ? activityInfo(value) : undefined
  const offered = allowed ?? ACTIVITIES.map((activity) => activity.value)
  // An entry from before the employee's activities were set keeps its activity visible.
  const values = value && !offered.includes(value) ? [...offered, value] : offered
  return (
    <Select
      label={label}
      placeholder="nicht festgelegt"
      clearable
      value={value}
      onChange={(next) => onChange(next as Activity | null)}
      data={values.map((activity) => ({
        value: activity,
        label:
          (activityInfo(activity)?.label ?? activity) +
          (activity === main ? ' (Haupttätigkeit)' : '') +
          (offered.includes(activity) ? '' : ' (nicht zugeordnet)'),
      }))}
      leftSection={selected ? <ColorSwatch color={selected.background} size={14} /> : undefined}
      renderOption={({ option }) => (
        <Group gap="xs" wrap="nowrap">
          <ColorSwatch color={activityInfo(option.value as Activity)?.background ?? '#ccc'} size={14} />
          <ActivityIcon activity={option.value as Activity} />
          <span>{option.label}</span>
        </Group>
      )}
      comboboxProps={{ withinPortal: true }}
    />
  )
}

const status = (value: SiteStatus) => SITE_STATUSES.find((candidate) => candidate.value === value)!

/** The two phases the plan is looked at in. */
export type Phase = 'Angebot' | 'Bauphase'

/** The activities of a phase in the order of the job and in their colours; planners may drag them onto a day. */
export function PhaseActivities({ phase, draggable = false }: { phase: Phase; draggable?: boolean }) {
  return (
    <span className="flow-steps" role="group" aria-label={`Tätigkeiten der ${status(phase).label}`}>
      {ACTIVITIES.filter((activity) => activity.phase === phase).map((activity) => (
        <span
          key={activity.value}
          className={draggable ? 'flow-step drag-source' : 'flow-step'}
          style={
            {
              '--entry-bg': activity.tint,
              '--entry-strong': activity.background,
              '--entry-text': textOn(activity.background),
            } as CSSProperties
          }
          title={draggable ? `${activity.label} auf einen Tag oder auf einen Einsatz ziehen` : undefined}
          {...dragSource({ kind: 'activity', activity: activity.value, label: activity.label }, draggable)}
        >
          <ActivityIcon activity={activity.value} size={11} />
          {activity.label}
        </span>
      ))}
    </span>
  )
}
