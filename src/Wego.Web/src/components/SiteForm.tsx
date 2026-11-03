import { Alert, Button, Group, Radio, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useState, type FormEvent, type ReactNode } from 'react'
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

/** A group of fields on a white card with a petrol edge and a small heading. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="form-section">
      <h3>{title}</h3>
      <Stack gap="sm">{children}</Stack>
    </section>
  )
}

/** The record of a construction site: client, address, and which of the two names it in the plan. */
export function SiteForm({ title, initial, onClose, onSave }: Props) {
  // Street and house number are one field; a house number kept apart before joins the street.
  const [site, setSite] = useState<SiteInput>(() => ({
    ...initial,
    street: [initial.street, initial.houseNumber].filter(Boolean).join(' ') || null,
    houseNumber: null,
  }))
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

  // The name comes from the chosen source; without a client (e.g. a first visit) the street names the site.
  const other: SiteNameSource = site.nameSource === 'Strasse' ? 'Auftraggeber' : 'Strasse'
  const named = siteName(site) || !siteName({ ...site, nameSource: other }) ? site : { ...site, nameSource: other }
  const name = siteName(named)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    // Opened from the day of an employee, the form is a child of that form in React: its submit stays here.
    event.stopPropagation()
    setBusy(true)
    setError('')
    try {
      await onSave(named)
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

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
                data={[{ value: 'Angebot', label: 'Angebotsphase' }, 'Bauphase']}
              />
            </div>
          )}
          <Section title="Kunde">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <TextInput label="Auftraggeber" maxLength={200} data-autofocus {...field('client')} />
              <TextInput label="Telefon Kunde" type="tel" maxLength={50} {...field('clientPhone')} />
            </SimpleGrid>
          </Section>
          <Section title="Adresse">
            <TextInput label="Straße und Hausnummer" maxLength={200} {...field('street')} />
            <TextInput
              label="Adresszusatz"
              placeholder="z. B. Hinterhaus, 3. OG links, mit oder ohne Aufzug"
              maxLength={200}
              {...field('addressAddition')}
            />
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              <TextInput label="PLZ" maxLength={10} {...field('postalCode')} />
              <TextInput label="Ort" maxLength={100} style={{ gridColumn: 'span 2' }} {...field('city')} />
            </SimpleGrid>
          </Section>
          <Section title="Name im Plan">
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
              ) : (
                'Bitte einen Auftraggeber oder eine Straße angeben.'
              )}
            </Text>
          </Section>
          <Section title="Planung">
            <DateInput
              label="Geplanter Start"
              valueFormat="DD.MM.YYYY"
              clearable
              maw={220}
              value={site.plannedStart}
              // An end set before stays, unless it would now come before the start.
              onChange={(value) =>
                setSite((current) => ({
                  ...current,
                  plannedStart: value,
                  plannedEnd: value && current.plannedEnd && current.plannedEnd < value ? null : current.plannedEnd,
                }))
              }
            />
            <Textarea
              label="Beschreibung"
              description="Art des Umbaus, Fliesen, Hinweise"
              autosize
              minRows={2}
              maxLength={1000}
              {...field('description')}
            />
          </Section>
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
