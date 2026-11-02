import { ActionIcon, Alert, Button, ColorInput, Group, Paper, SegmentedControl, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api/client'
import type { ActivityDef, ActivityInput } from '../api/types'
import { coloursOf, SITE_STATUSES } from '../lib/activities'
import { ActivityIcon } from './ActivityIcon'
import { Sheet } from './Sheet'

const PHASES = ['Angebot', 'Bauphase'] as const
const phaseLabel = (phase: ActivityDef['phase']) => SITE_STATUSES.find((status) => status.value === phase)!.label

/**
 * Planer G: the activities of the plan, per phase in the order of the job. New ones, a new name, colour
 * or phase, a new place in the order, and deleting one (its entries stay, without the activity).
 */
export function ActivitiesAdmin({ onChanged }: { onChanged: () => Promise<void> }) {
  const [activities, setActivities] = useState<ActivityDef[]>([])
  const [error, setError] = useState('')
  // key null: a new activity
  const [editing, setEditing] = useState<{ key: string | null; input: ActivityInput } | null>(null)

  const load = useCallback(() => {
    api.activities().then(setActivities, (e) => setError(messageOf(e)))
  }, [])
  useEffect(load, [load])

  /** After a change: this list and the rest of the application read the activities anew. */
  const changed = async (message: string) => {
    load()
    await onChanged()
    notifications.show({ message, color: 'green' })
  }

  const byPhase = (phase: ActivityDef['phase']) =>
    activities.filter((activity) => activity.phase === phase).sort((a, b) => a.sortOrder - b.sortOrder)

  /** Moves an activity one place up or down within its phase. */
  const move = async (activity: ActivityDef, direction: -1 | 1) => {
    const lists = PHASES.map(byPhase)
    const list = lists[PHASES.indexOf(activity.phase)]
    const index = list.indexOf(activity)
    const other = index + direction
    if (other < 0 || other >= list.length) return
    ;[list[index], list[other]] = [list[other], list[index]]
    try {
      setActivities(await api.orderActivities(lists.flat().map((a) => a.key)))
      await onChanged()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  const remove = async (activity: ActivityDef) => {
    try {
      const usage = await api.activityUsage(activity.key)
      const used = [
        usage.entries > 0 && `${usage.entries} Einträgen im Plan (sie bleiben, ohne Tätigkeit)`,
        usage.employees > 0 && `${usage.employees} Mitarbeitern als Fähigkeit`,
        usage.sites > 0 && `${usage.sites} Baustellen als Aufgabe`,
      ].filter(Boolean)
      const question = used.length
        ? `„${activity.label}“ wird verwendet bei ${used.join(', ')}.\n\nTrotzdem löschen? Dort wird die Tätigkeit entfernt.`
        : `„${activity.label}“ löschen?`
      if (!window.confirm(question)) return
      await api.deleteActivity(activity.key)
      await changed(`„${activity.label}“ gelöscht.`)
    } catch (e) {
      setError(messageOf(e))
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    try {
      if (editing.key === null) await api.createActivity(editing.input)
      else await api.updateActivity(editing.key, editing.input)
      setEditing(null)
      await changed('Tätigkeit gespeichert.')
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Die Tätigkeiten der Planung, je Phase in der Reihenfolge des Ablaufs. Wer welche Tätigkeit ausführt, steht
        beim Mitarbeiter. Eine neue Tätigkeit wird Baustellen als Aufgabe angelegt, sobald sie in ihre Phase wechseln.
      </Text>
      <Group>
        <Button onClick={() => setEditing({ key: null, input: { label: '', phase: 'Bauphase', color: '#607d8b' } })}>
          + Tätigkeit anlegen
        </Button>
      </Group>
      {error && (
        <Alert color="red" variant="light" withCloseButton onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {PHASES.map((phase) => (
        <Paper key={phase} withBorder p="sm">
          <Title order={4} mb="xs">
            {phaseLabel(phase)}
          </Title>
          <Table verticalSpacing={4}>
            <Table.Tbody>
              {byPhase(phase).map((activity, index, list) => {
                const colours = coloursOf(activity.color)
                return (
                  <Table.Tr key={activity.key}>
                    <Table.Td w={40}>
                      <span className="activity-swatch" style={{ background: colours.tint, color: colours.edge, borderColor: colours.background }}>
                        <ActivityIcon activity={activity.key} size={14} />
                      </span>
                    </Table.Td>
                    <Table.Td fw={600}>{activity.label}</Table.Td>
                    <Table.Td w={220}>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <ActionIcon
                          variant="default"
                          aria-label={`${activity.label} nach oben`}
                          disabled={index === 0}
                          onClick={() => move(activity, -1)}
                        >
                          ↑
                        </ActionIcon>
                        <ActionIcon
                          variant="default"
                          aria-label={`${activity.label} nach unten`}
                          disabled={index === list.length - 1}
                          onClick={() => move(activity, 1)}
                        >
                          ↓
                        </ActionIcon>
                        <Button
                          size="compact-sm"
                          variant="light"
                          onClick={() =>
                            setEditing({ key: activity.key, input: { label: activity.label, phase: activity.phase, color: activity.color } })
                          }
                        >
                          Bearbeiten
                        </Button>
                        <Button size="compact-sm" variant="subtle" color="red" onClick={() => remove(activity)}>
                          Löschen
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Paper>
      ))}

      {editing && (
        <Sheet
          onClose={() => setEditing(null)}
          title={<Text fw={700}>{editing.key === null ? 'Neue Tätigkeit' : 'Tätigkeit bearbeiten'}</Text>}
          size="sm"
        >
          <form onSubmit={submit}>
            <Stack gap="sm">
              <TextInput
                label="Name"
                required
                maxLength={100}
                data-autofocus
                value={editing.input.label}
                onChange={(e) => {
                  const label = e.currentTarget.value
                  setEditing((current) => current && { ...current, input: { ...current.input, label } })
                }}
              />
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Phase
                </Text>
                <SegmentedControl
                  value={editing.input.phase}
                  onChange={(value) =>
                    setEditing((current) => current && { ...current, input: { ...current.input, phase: value as ActivityDef['phase'] } })
                  }
                  data={PHASES.map((value) => ({ value, label: phaseLabel(value) }))}
                />
              </div>
              <ColorInput
                label="Farbe im Plan"
                format="hex"
                value={editing.input.color}
                onChange={(color) => setEditing((current) => current && { ...current, input: { ...current.input, color } })}
                swatches={['#5fd6cf', '#a1887f', '#b5bd3a', '#f46a6a', '#ffc000', '#7db4f2', '#c49be3', '#f472c9', '#3f51b5', '#607d8b']}
              />
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setEditing(null)}>
                  Abbrechen
                </Button>
                <Button type="submit">Speichern</Button>
              </Group>
            </Stack>
          </form>
        </Sheet>
      )}
    </Stack>
  )
}
