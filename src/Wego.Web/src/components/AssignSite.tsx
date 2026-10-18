import { Alert, Button, Checkbox, ColorSwatch, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { useState, type FormEvent } from 'react'
import { messageOf } from '../api/client'
import type { Activity, DayEntryInput, NamedItem, PlanEmployee, Site, SiteInput } from '../api/types'
import { ACTIVITIES, activityLabel, allowedActivities } from '../lib/activities'
import { Sheet } from './Sheet'
import { SitePicker } from './SitePicker'

/** 'main': every employee gets their own main activity. */
export type ActivityChoice = Activity | 'main'

interface Props {
  cellCount: number
  /** The employees of the selected cells. */
  employees: PlanEmployee[]
  sites: Site[]
  onCreateSite: (input: SiteInput) => Promise<Site>
  recentSites: NamedItem[]
  onClose: () => void
  /** add: keep what is already planned on those days and add the site as a further entry. */
  onApply: (entry: DayEntryInput, add: boolean, activity: ActivityChoice) => Promise<void>
}

/** Puts one construction site on all selected cells at once. */
export function AssignSite({ cellCount, employees, sites, onCreateSite, recentSites, onClose, onApply }: Props) {
  const [siteId, setSiteId] = useState<number | null>(null)
  const [activity, setActivity] = useState<ActivityChoice>('main')
  // Who cannot do the chosen activity keeps their main activity.
  const unable = activity === 'main' ? [] : employees.filter((e) => !allowedActivities(e).includes(activity))
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [add, setAdd] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const apply = async (chosen: number | null) => {
    if (chosen === null) return
    setBusy(true)
    setError('')
    try {
      await onApply(
        {
          type: 'Baustelle',
          siteId: chosen,
          activity: null,
          startTime: start ? `${start}:00` : null,
          endTime: end ? `${end}:00` : null,
          note: note.trim() || null,
        },
        add,
        activity,
      )
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void apply(siteId)
  }

  return (
    <Sheet onClose={onClose} title={<Text fw={700}>Baustelle für {cellCount} Felder</Text>} size="md">
      <form onSubmit={submit}>
        <Stack gap="sm">
          <Select
            label="Tätigkeit"
            value={activity}
            onChange={(value) => setActivity((value ?? 'main') as ActivityChoice)}
            allowDeselect={false}
            data={[
              { value: 'main', label: 'Haupttätigkeit des jeweiligen Mitarbeiters' },
              ...ACTIVITIES.map((a) => ({ value: a.value, label: a.label })),
            ]}
            leftSection={
              activity === 'main' ? undefined : (
                <ColorSwatch color={ACTIVITIES.find((a) => a.value === activity)!.background} size={14} />
              )
            }
          />
          {unable.length > 0 && (
            <Alert color="yellow" variant="light">
              {unable.map((e) => e.name).join(', ')} {unable.length === 1 ? 'führt' : 'führen'} keine{' '}
              {activityLabel(activity as Activity)} aus und {unable.length === 1 ? 'bekommt' : 'bekommen'} die eigene
              Haupttätigkeit.
            </Alert>
          )}
          {recentSites.length > 0 && (
            <div>
              <Text size="xs" c="dimmed" mb={4}>
                Direkt übernehmen
              </Text>
              <Group gap={6}>
                {recentSites.map((site) => (
                  <button
                    type="button"
                    key={site.id}
                    className="site-pick"
                    disabled={busy}
                    onClick={() => apply(site.id)}
                  >
                    {site.name}
                  </button>
                ))}
              </Group>
            </div>
          )}
          <SitePicker sites={sites} value={siteId} onChange={setSiteId} onCreate={onCreateSite} required />
          <Group grow gap="xs">
            <TextInput label="von" type="time" value={start} onChange={(e) => setStart(e.currentTarget.value)} />
            <TextInput label="bis" type="time" value={end} onChange={(e) => setEnd(e.currentTarget.value)} />
          </Group>
          <TextInput label="Notiz" value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={500} />
          <Checkbox
            label="Zu vorhandenen Einträgen hinzufügen (sonst ersetzen)"
            checked={add}
            onChange={(e) => setAdd(e.currentTarget.checked)}
          />
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" loading={busy}>
              Übernehmen
            </Button>
          </Group>
        </Stack>
      </form>
    </Sheet>
  )
}
