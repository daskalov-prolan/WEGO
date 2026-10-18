import { Badge, Button, ColorSwatch, Group, MultiSelect, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { Activity } from '../api/types'
import { ACTIVITIES, activityLabel } from '../lib/activities'
import { suggestActivities } from '../lib/employees'
import { ActivitySelect } from './ActivityPicker'

const colourOf = (activity: Activity) => ACTIVITIES.find((a) => a.value === activity)!.background
const tintOf = (activity: Activity) => ACTIVITIES.find((a) => a.value === activity)!.tint

interface Skills {
  mainActivity: Activity | null
  additionalActivities: Activity[]
}

/** The main activity first, in its full colour and stressed; the additional ones light in their colour. */
export function ActivityBadges({ mainActivity, additionalActivities }: Skills) {
  return (
    <Group gap={4}>
      {mainActivity && (
        <Badge
          variant="filled"
          title="Haupttätigkeit"
          className="skill-main"
          styles={{ root: { background: colourOf(mainActivity), color: '#1b1b1b', boxShadow: `0 0 0 2px #fff, 0 0 0 3.5px ${colourOf(mainActivity)}` } }}
        >
          ★ {activityLabel(mainActivity)}
        </Badge>
      )}
      {additionalActivities.map((activity) => (
        <Badge
          key={activity}
          variant="light"
          title="Weitere Tätigkeit"
          styles={{ root: { background: tintOf(activity), color: '#14232a', border: `1px solid ${colourOf(activity)}` } }}
          leftSection={<ColorSwatch color={colourOf(activity)} size={8} withShadow={false} />}
        >
          {activityLabel(activity)}
        </Badge>
      ))}
    </Group>
  )
}

/**
 * Main and additional activities of an employee, with a suggestion from what they did in the plan.
 * New entries get the main activity; it can only be changed to one of the additional ones.
 */
export function ActivitiesEditor({
  employeeId,
  year,
  value,
  onChange,
  disabled = false,
}: {
  /** Known employees get a suggestion from their entries of the year. */
  employeeId: number | null
  year: number
  value: Skills
  onChange: (value: Skills) => void
  disabled?: boolean
}) {
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text fw={600} size="sm">
          Tätigkeiten
        </Text>
        {employeeId !== null && (
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={disabled}
            onClick={async () => {
              const suggestion = await suggestActivities(employeeId, year)
              if (!suggestion.mainActivity) {
                notifications.show({ message: `Keine Einsätze mit Tätigkeit in ${year}.` })
                return
              }
              onChange(suggestion)
            }}
          >
            Aus Einsätzen {year} vorschlagen
          </Button>
        )}
      </Group>
      <Text size="xs" c="dimmed">
        Neue Einsätze bekommen die Haupttätigkeit; ändern lässt sie sich nur auf eine der weiteren. Ohne Angabe sind
        alle Tätigkeiten möglich.
      </Text>
      <ActivitySelect
        label="Haupttätigkeit"
        value={value.mainActivity}
        onChange={(mainActivity) =>
          onChange({ mainActivity, additionalActivities: value.additionalActivities.filter((a) => a !== mainActivity) })
        }
      />
      <MultiSelect
        label="Weitere Tätigkeiten"
        placeholder={value.additionalActivities.length ? undefined : 'keine'}
        value={value.additionalActivities}
        onChange={(values) => onChange({ ...value, additionalActivities: values as Activity[] })}
        data={ACTIVITIES.filter((a) => a.value !== value.mainActivity).map((a) => ({ value: a.value, label: a.label }))}
        clearable
        disabled={disabled}
        comboboxProps={{ withinPortal: true }}
      />
    </Stack>
  )
}
