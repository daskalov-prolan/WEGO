import { ColorSwatch, Group, Select, Text } from '@mantine/core'
import { Fragment, type CSSProperties } from 'react'
import type { Activity, SiteStatus } from '../api/types'
import { ABSENCE, ACTIVITIES, PUBLIC_HOLIDAY, SCHOOL_HOLIDAY, SITE_STATUSES } from '../lib/activities'

const byValue = new Map(ACTIVITIES.map((activity) => [activity.value, activity]))

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
  const selected = value ? byValue.get(value) : undefined
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
          byValue.get(activity)!.label +
          (activity === main ? ' (Haupttätigkeit)' : '') +
          (offered.includes(activity) ? '' : ' (nicht zugeordnet)'),
      }))}
      leftSection={selected ? <ColorSwatch color={selected.background} size={14} /> : undefined}
      renderOption={({ option }) => (
        <Group gap="xs" wrap="nowrap">
          <ColorSwatch color={byValue.get(option.value as Activity)?.background ?? '#ccc'} size={14} />
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

/** A status as a box in its colour, with its activities as steps in their colours. */
function Stage({ value }: { value: 'Angebot' | 'Bauphase' }) {
  const info = status(value)
  const steps = ACTIVITIES.filter((activity) => activity.phase === value)
  return (
    <div className="flow-stage" style={{ '--stage': info.hex } as CSSProperties}>
      <span className="flow-stage-name">{info.label}</span>
      <span className="flow-steps">
        {steps.map((activity, index) => (
          <Fragment key={activity.value}>
            {index > 0 && <Arrow />}
            <span
              className="flow-step"
              style={{ '--entry-bg': activity.tint, '--entry-strong': activity.background } as CSSProperties}
            >
              {activity.label}
            </span>
          </Fragment>
        ))}
      </span>
    </div>
  )
}

/**
 * The colours of the plan as the course of a job: the statuses one after the other, in each of them its
 * activities in their colours; cancelled can follow any status. Absences and holidays as dots beside it.
 */
export function ActivityLegend() {
  return (
    <div className="activity-legend">
      <div className="flow" role="img" aria-label="Ablauf: Angebot, dann Bauphase, dann Abgeschlossen; Storniert aus jedem Status">
        <Stage value="Angebot" />
        <span className="flow-arrow big" aria-hidden>
          ➜
        </span>
        <Stage value="Bauphase" />
        <span className="flow-arrow big" aria-hidden>
          ➜
        </span>
        <span className="flow-end" style={{ '--stage': status('Abgeschlossen').hex } as CSSProperties}>
          Abgeschlossen
        </span>
        <span className="flow-cancel" style={{ '--stage': status('Storniert').hex } as CSSProperties}>
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