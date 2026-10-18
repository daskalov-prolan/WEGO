import { ActionIcon, Group, Select, Text, Tooltip } from '@mantine/core'
import { useState } from 'react'
import type { Site, SiteInput } from '../api/types'
import { emptySite, formatAddress } from '../lib/sites'
import { SiteForm } from './SiteForm'

interface Props {
  sites: Site[]
  value: number | null
  onChange: (siteId: number | null) => void
  /** Creates a site from the form; the new site is selected right away. */
  onCreate: (input: SiteInput) => Promise<Site>
  label?: string
  required?: boolean
}

/** Choice of a construction site, searchable by name, client and address; new sites are created on the spot. */
export function SitePicker({ sites, value, onChange, onCreate, label = 'Baustelle', required }: Props) {
  const [creating, setCreating] = useState(false)
  const byId = new Map(sites.map((site) => [String(site.id), site]))

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
          data={sites.map((site) => ({
            value: String(site.id),
            label: site.name,
          }))}
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
