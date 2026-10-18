import { ColorSwatch, Group, Select, Text } from '@mantine/core'
import type { Activity } from '../api/types'
import { ABSENCE, ACTIVITIES, PUBLIC_HOLIDAY, SCHOOL_HOLIDAY } from '../lib/activities'

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

function Item({ color, label }: { color: string; label: string }) {
  return (
    <Group gap={5} wrap="nowrap">
      <ColorSwatch color={color} size={12} withShadow={false} />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  )
}

/** The colours of the plan with their meaning: activities in the order of the job, then absences and holidays. */
export function ActivityLegend() {
  return (
    <Group gap="sm" className="activity-legend" wrap="wrap">
      {ACTIVITIES.map((activity, index) => (
        <Item key={activity.value} color={activity.background} label={`${index + 1}. ${activity.label}`} />
      ))}
      <Item color={ABSENCE.background} label="Urlaub / Krank" />
      <Item color={PUBLIC_HOLIDAY.background} label="Feiertag" />
      <Item color={SCHOOL_HOLIDAY.background} label="Schulferien" />
    </Group>
  )
}