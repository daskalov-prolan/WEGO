import { Badge, Button, ColorSwatch, Group, MultiSelect, SimpleGrid, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { Activity } from '../api/types'
import { ACTIVITIES, activityLabel } from '../lib/activities'
import { suggestActivities } from '../lib/employees'
import { ActivitySelect } from './ActivityPicker'

const colourOf = (activity: Activity) => ACTIVITIES.find((a) => a.value === activity)!.background

interface Skills {
  mainActivity: Activity | null
  additionalActivities: Activity[]
}

/** The main activity in its colour, the additional ones outlined. */
export function ActivityBadges({ mainActivity, additionalActivities }: Skills) {
  return (
    <Group gap={4}>
      {mainActivity && (
        <Badge variant="filled" styles={{ root: { background: colourOf(mainActivity), color: '#1b1b1b' } }}>
          {activityLabel(mainActivity)}
        </Badge>
      )}
      {additionalActivities.map((activity) => (
        <Badge key={activity} variant="outline" color="gray" leftSection={<ColorSwatch color={colourOf(activity)} size={8} />}>
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
  wide = false,
}: {
  /** Known employees get a suggestion from their entries of the year. */
  employeeId: number | null
  year: number
  value: Skills
  onChange: (value: Skills) => void
  disabled?: boolean
  /** On a page: main and additional activities side by side. */
  wide?: boolean
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
      <SimpleGrid cols={wide ? { base: 1, sm: 2 } : 1} spacing="xs">
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
      </SimpleGrid>
    </Stack>
  )
}
