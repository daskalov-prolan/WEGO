import { ActionIcon, Anchor, Group, Select, Text, Tooltip } from '@mantine/core'
import { useState } from 'react'
import type { Site, SiteInput } from '../api/types'
import { isOpen } from '../lib/activities'
import { emptySite, formatAddress, toSiteInput } from '../lib/sites'
import { SiteForm } from './SiteForm'
import { SiteSheet } from './SiteSheet'

interface Props {
  sites: Site[]
  value: number | null
  onChange: (siteId: number | null) => void
  /** Creates a site from the form; the new site is selected right away. */
  onCreate: (input: SiteInput) => Promise<Site>
  /** Saves changes made in the record of the chosen site. */
  onUpdate?: (id: number, input: SiteInput) => Promise<Site>
  label?: string
  required?: boolean
}

/** Choice of a construction site, searchable by name, client and address; new sites are created on the spot. */
export function SitePicker({ sites, value, onChange, onCreate, onUpdate, label = 'Baustelle', required }: Props) {
  const [creating, setCreating] = useState(false)
  // The record of the chosen site, opened on top; closing it leads back here.
  const [viewing, setViewing] = useState<'record' | 'edit' | null>(null)
  const byId = new Map(sites.map((site) => [String(site.id), site]))
  const chosen = value === null ? undefined : byId.get(String(value))
  const chosenAddress = chosen && formatAddress(chosen)

  return (
    <>
      <Group gap={6} align="flex-end" wrap="nowrap">
        <Select
          label={label}
          placeholder="Baustelle suchen"
          searchable
          clearable
          required={required}
          limit={30}
          style={{ flex: 1 }}
          value={value === null ? null : String(value)}
          onChange={(next) => onChange(next === null ? null : Number(next))}
          // Done and cancelled sites are not offered for new work; one chosen before stays visible.
          data={sites
            .filter((site) => isOpen(site.status) || site.id === value)
            .map((site) => ({ value: String(site.id), label: site.status === 'Angebot' ? `${site.name} (Angebot)` : site.name }))}
          filter={({ options, search }) => {
            const needle = search.trim().toLowerCase()
            return options.filter((option) => {
              if (!('value' in option)) return true
              const site = byId.get(option.value)
              return !needle || [site?.name, site?.client, site && formatAddress(site)].join(' ').toLowerCase().includes(needle)
            })
          }}
          renderOption={({ option }) => {
            const site = byId.get(option.value)
            const address = site && formatAddress(site)
            return (
              <div>
                <Text size="sm">{option.label}</Text>
                {(address || (site?.nameSource === 'Strasse' && site.client)) && (
                  <Text size="xs" c="dimmed">
                    {[site?.nameSource === 'Strasse' ? site.client : null, address].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </div>
            )
          }}
          comboboxProps={{ withinPortal: true }}
        />
        <Tooltip label="Neue Baustelle anlegen">
          <ActionIcon variant="light" size={36} onClick={() => setCreating(true)} aria-label="Neue Baustelle anlegen">
            +
          </ActionIcon>
        </Tooltip>
      </Group>
      {chosen && (
        <Text size="xs" mt={2}>
          <Anchor size="xs" fw={600} onClick={() => setViewing('record')}>
            Datensatz öffnen: {chosen.name}
          </Anchor>
          {chosenAddress && <span className="muted-inline"> · {chosenAddress}</span>}
        </Text>
      )}
      {chosen && viewing === 'record' && (
        <SiteSheet
          site={chosen}
          canEdit={onUpdate !== undefined}
          showPageLink={false}
          onEdit={() => setViewing('edit')}
          onClose={() => setViewing(null)}
        />
      )}
      {chosen && viewing === 'edit' && onUpdate && (
        <SiteForm
          title="Baustelle bearbeiten"
          initial={toSiteInput(chosen)}
          onClose={() => setViewing('record')}
          onSave={async (input) => {
            await onUpdate(chosen.id, input)
            setViewing('record')
          }}
        />
      )}
      {creating && (
        <SiteForm
          title="Neue Baustelle"
          initial={emptySite}
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            const site = await onCreate(input)
            onChange(site.id)
            setCreating(false)
          }}
        />
      )}
    </>
  )
}
