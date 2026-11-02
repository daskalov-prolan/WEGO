import { ColorSwatch, Group, Select, Text } from '@mantine/core'
import { Fragment, type CSSProperties, type ReactNode } from 'react'
import type { Activity, SiteStatus } from '../api/types'
import { ActivityIcon } from './ActivityIcon'
import { ABSENCE, ACTIVITIES, activityInfo, PUBLIC_HOLIDAY, SCHOOL_HOLIDAY, SITE_STATUSES } from '../lib/activities'
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

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <Group gap={5} wrap="nowrap">
      <ColorSwatch color={color} size={12} withShadow={false} />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  )
}

function Arrow() {
  return (
    <span className="flow-arrow" aria-hidden>
      →
    </span>
  )
}

const status = (value: SiteStatus) => SITE_STATUSES.find((candidate) => candidate.value === value)!

/** The two phases the plan is looked at in. */
export type Phase = 'Angebot' | 'Bauphase'

/** The colours of absences and holidays, as a short key. */
export function DayKey() {
  return (
    <Group gap="sm" wrap="nowrap" className="day-key">
      <Dot color={ABSENCE.background} label="Urlaub / Krank" />
      <Dot color={PUBLIC_HOLIDAY.background} label="Feiertag" />
      <Dot color={SCHOOL_HOLIDAY.background} label="Schulferien" />
    </Group>
  )
}

/** The activities of a phase in the order of the job and in their colours; planners may drag them onto a day. */
export function PhaseActivities({ phase, draggable = false }: { phase: Phase; draggable?: boolean }) {
  return (
    <span className="flow-steps" role="group" aria-label={`Tätigkeiten der ${status(phase).label}`}>
      {ACTIVITIES.filter((activity) => activity.phase === phase).map((activity) => (
        <span
          key={activity.value}
          className={draggable ? 'flow-step drag-source' : 'flow-step'}
          style={{ '--entry-bg': activity.tint, '--entry-strong': activity.background } as CSSProperties}
          title={draggable ? `${activity.label} auf einen Tag eines Mitarbeiters ziehen` : undefined}
          {...dragSource({ kind: 'activity', activity: activity.value, label: activity.label }, draggable)}
        >
          <ActivityIcon activity={activity.value} size={11} />
          {activity.label}
        </span>
      ))}
    </span>
  )
}

/**
 * The course of one site, in the look of the legend: the statuses one after the other, the current one
 * opened up with its activities. How an activity looks (open, planned, cancelled) is up to the caller.
 */
export function SiteFlow({ current, renderStep }: { current: SiteStatus; renderStep: (activity: Activity) => ReactNode }) {
  const stage = (value: 'Angebot' | 'Bauphase') => {
    const info = status(value)
    const steps = ACTIVITIES.filter((activity) => activity.phase === value)
    return (
      <div
        className={value === current ? 'flow-stage current' : 'flow-stage other'}
        style={{ '--stage': info.hex } as CSSProperties}
        aria-current={value === current ? 'step' : undefined}
      >
        <span className="flow-stage-name">{info.label}</span>
        {value === current && (
          <span className="flow-steps">
            {steps.map((activity, index) => (
              <Fragment key={activity.value}>
                {index > 0 && <Arrow />}
                {renderStep(activity.value)}
              </Fragment>
            ))}
          </span>
        )}
      </div>
    )
  }
  return (
    <div className="activity-legend">
      <div className="flow site-flow" role="group" aria-label="Ablauf der Baustelle">
        {stage('Angebot')}
        <span className="flow-arrow big" aria-hidden>
          ➜
        </span>
        {stage('Bauphase')}
        <span className="flow-arrow big" aria-hidden>
          ➜
        </span>
        <span
          className={current === 'Abgeschlossen' ? 'flow-end current' : 'flow-end other'}
          style={{ '--stage': status('Abgeschlossen').hex } as CSSProperties}
        >
          Abgeschlossen
        </span>
        <span
          className={current === 'Storniert' ? 'flow-cancel current' : 'flow-cancel other'}
          style={{ '--stage': status('Storniert').hex } as CSSProperties}
        >
          jederzeit ↘ Storniert
        </span>
      </div>
      <Group gap="sm" wrap="wrap">
        <Dot color={ABSENCE.background} label="Urlaub / Krank" />
        <Dot color={PUBLIC_HOLIDAY.background} label="Feiertag" />
        <Dot color={SCHOOL_HOLIDAY.background} label="Schulferien" />
      </Group>
    </div>
  )
}
