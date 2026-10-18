import { ColorSwatch, Group, Select, Text } from '@mantine/core'
import type { Activity } from '../api/types'
import { ACTIVITIES } from '../lib/activities'

const byValue = new Map(ACTIVITIES.map((activity) => [activity.value, activity]))

/** Choice of the activity on the site, each with its colour from the plan. */
export function ActivitySelect({
  value,
  onChange,
}: {
  value: Activity | null
  onChange: (value: Activity | null) => void
}) {
  const selected = value ? byValue.get(value) : undefined
  return (
    <Select
      label="Tätigkeit"
      placeholder="nicht festgelegt"
      clearable
      value={value}
      onChange={(next) => onChange(next as Activity | null)}
      data={ACTIVITIES.map((activity) => ({ value: activity.value, label: activity.label }))}
      leftSection={selected ? <ColorSwatch color={selected.color} size={14} /> : undefined}
      renderOption={({ option }) => (
        <Group gap="xs" wrap="nowrap">
          <ColorSwatch color={byValue.get(option.value as Activity)?.color ?? '#ccc'} size={14} />
          <span>{option.label}</span>
        </Group>
      )}
      comboboxProps={{ withinPortal: true }}
    />
  )
}

/** The colours of the plan with their meaning, in the order of the job. */
export function ActivityLegend() {
  return (
    <Group gap="sm" className="activity-legend" wrap="wrap">
      {ACTIVITIES.map((activity, index) => (
        <Group gap={5} key={activity.value} wrap="nowrap">
          <ColorSwatch color={activity.color} size={12} withShadow={false} />
          <Text size="xs" c="dimmed">
            {index + 1}. {activity.label}
          </Text>
        </Group>
      ))}
    </Group>
  )
}
