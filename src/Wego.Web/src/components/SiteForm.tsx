import { Alert, Button, Group, Radio, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useState, type FormEvent } from 'react'
import { messageOf } from '../api/client'
import type { SiteInput, SiteNameSource, SiteStatus } from '../api/types'
import { siteName } from '../lib/sites'
import { Sheet } from './Sheet'

interface Props {
  title: string
  initial: SiteInput
  onClose: () => void
  /** Saves the site; a rejected promise keeps the form open and shows the message. */
  onSave: (input: SiteInput) => Promise<void>
}

/** The record of a construction site: client, address, and which of the two names it in the plan. */
export function SiteForm({ title, initial, onClose, onSave }: Props) {
  const [site, setSite] = useState<SiteInput>(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const field = (key: keyof SiteInput) => ({
    value: site[key] ?? '',
    onChange: (event: { currentTarget: { value: string } }) => {
      // Read the value now: React clears the event before the state update below runs.
      const value = event.currentTarget.value || null
      setSite((current) => ({ ...current, [key]: value }))
    },
  })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSave(site)
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  const name = siteName(site)

  return (
    <Sheet onClose={onClose} title={<Text fw={700}>{title}</Text>}>
      <form onSubmit={submit}>
        <Stack gap="sm">
          {initial.status !== undefined && (
            <div>
              <Text size="sm" fw={500} mb={4}>
                Beginnt als
              </Text>
              <SegmentedControl
                value={site.status}
                onChange={(value) => setSite((current) => ({ ...current, status: value as SiteStatus }))}
                data={['Angebot', 'Bauphase']}
              />
            </div>
          )}
          <TextInput
            label="Auftraggeber"
            description="Kunde oder Hausverwaltung"
            maxLength={200}
            data-autofocus
            {...field('client')}
          />
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <TextInput label="Straße" maxLength={200} style={{ gridColumn: 'span 2' }} {...field('street')} />
            <TextInput label="Hausnummer" maxLength={20} {...field('houseNumber')} />
          </SimpleGrid>
          <TextInput
            label="Adresszusatz"
            placeholder="z. B. Hinterhaus, 3. OG links"
            maxLength={200}
            {...field('addressAddition')}
          />
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <TextInput label="PLZ" maxLength={10} {...field('postalCode')} />
            <TextInput label="Ort" maxLength={100} style={{ gridColumn: 'span 2' }} {...field('city')} />
          </SimpleGrid>
          <Radio.Group
            label="Name in den Übersichten"
            value={site.nameSource}
            onChange={(value) => setSite((current) => ({ ...current, nameSource: value as SiteNameSource }))}
          >
            <Group gap="lg" mt={4}>
              <Radio value="Auftraggeber" label="Auftraggeber" />
              <Radio value="Strasse" label="Straße" />
            </Group>
          </Radio.Group>
          <Text size="sm" c={name ? 'wego.9' : 'red.7'}>
            {name ? (
              <>
                Im Plan steht: <strong>{name}</strong>
              </>
            ) : site.nameSource === 'Strasse' ? (
              'Bitte eine Straße angeben.'
            ) : (
              'Bitte einen Auftraggeber angeben.'
            )}
          </Text>
          <SimpleGrid cols={2} spacing="sm">
            <DateInput
              label="Geplanter Start"
              valueFormat="DD.MM.YYYY"
              clearable
              value={site.plannedStart}
              onChange={(value) => setSite((current) => ({ ...current, plannedStart: value }))}
            />
            <DateInput
              label="Geplantes Ende"
              valueFormat="DD.MM.YYYY"
              clearable
              minDate={site.plannedStart ?? undefined}
              value={site.plannedEnd}
              onChange={(value) => setSite((current) => ({ ...current, plannedEnd: value }))}
            />
          </SimpleGrid>
          <Textarea
            label="Beschreibung"
            description="Art des Umbaus, Fliesen, Hinweise"
            autosize
            minRows={2}
            maxLength={1000}
            {...field('description')}
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
            <Button type="submit" loading={busy} disabled={!name}>
              Speichern
            </Button>
          </Group>
        </Stack>
      </form>
    </Sheet>
  )
}
