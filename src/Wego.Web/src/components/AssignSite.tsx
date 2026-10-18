import { Alert, Autocomplete, Button, Checkbox, Group, Stack, Text, TextInput } from '@mantine/core'
import { useState, type FormEvent } from 'react'
import { messageOf } from '../api/client'
import type { DayEntryInput, NamedItem } from '../api/types'
import { siteStyle } from '../lib/ui'
import { Sheet } from './Sheet'

interface Props {
  cellCount: number
  customerNames: string[]
  recentSites: NamedItem[]
  onClose: () => void
  /** add: keep what is already planned on those days and add the site as a further entry. */
  onApply: (entry: DayEntryInput, add: boolean) => Promise<void>
}

/** Puts one construction site on all selected cells at once. */
export function AssignSite({ cellCount, customerNames, recentSites, onClose, onApply }: Props) {
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [add, setAdd] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const apply = async (customerName: string) => {
    setBusy(true)
    setError('')
    try {
      await onApply(
        {
          type: 'Baustelle',
          customerName: customerName.trim(),
          startTime: start ? `${start}:00` : null,
          endTime: end ? `${end}:00` : null,
          note: note.trim() || null,
        },
        add,
      )
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void apply(name)
  }

  return (
    <Sheet onClose={onClose} title={<Text fw={700}>Baustelle für {cellCount} Felder</Text>} size="md">
      <form onSubmit={submit}>
        <Stack gap="sm">
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
                    style={siteStyle(site.id)}
                    disabled={busy}
                    onClick={() => apply(site.name)}
                  >
                    {site.name}
                  </button>
                ))}
              </Group>
            </div>
          )}
          <Autocomplete
            label="Kunde"
            value={name}
            onChange={setName}
            data={customerNames}
            limit={8}
            required
            maxLength={200}
            data-autofocus
          />
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
