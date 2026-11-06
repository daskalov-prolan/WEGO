import { Button, Group, Select, Text } from '@mantine/core'
import { useState } from 'react'
import type { Site, SiteInput } from '../api/types'
import { isOpen } from '../lib/activities'
import { emptySite, formatAddress } from '../lib/sites'
import { SiteForm } from './SiteForm'
import { CallButton, SiteWayButtons } from './SiteActions'

interface Props {
  sites: Site[]
  value: number | null
  onChange: (siteId: number | null) => void
  /** Creates a site from the form; the new site is selected right away. */
  onCreate: (input: SiteInput) => Promise<Site>
  /** Planners: goes to the page of the chosen site, to add or correct its details. */
  onGoToSite?: (siteId: number) => void
  /** What a new site starts with, e.g. the day as its start; empty without it. */
  newSite?: SiteInput
  label?: string
  required?: boolean
}

/** Choice of a construction site, searchable by name, client and address; new sites are created on the spot. */
export function SitePicker({ sites, value, onChange, onCreate, onGoToSite, newSite = emptySite, label = 'Baustelle', required }: Props) {
  const [creating, setCreating] = useState(false)
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
            const matches = options.filter((option) => {
              if (!('value' in option)) return true
              const site = byId.get(option.value)
              return (
                !needle ||
                [site?.name, site?.client, site?.labelProjectNumber, site && formatAddress(site)]
                  .join(' ')
                  .toLowerCase()
                  .includes(needle)
              )
            })
            // Names that begin with what is typed come first: one letter jumps to the sites with it.
            const begins = (option: (typeof options)[number]) =>
              'value' in option && (byId.get(option.value)?.name.toLowerCase().startsWith(needle) ?? false)
            return needle ? [...matches.filter(begins), ...matches.filter((option) => !begins(option))] : matches
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
        <Button variant="light" h={36} px="sm" onClick={() => setCreating(true)} aria-label="Neue Baustelle anlegen">
          + Neue Baustelle
        </Button>
      </Group>
      {chosen && (
        <div className="site-contact">
          <Text size="sm">
            <span className="muted-inline">Adresse: </span>
            {chosenAddress ?? '–'}
          </Text>
          <Text size="sm">
            <span className="muted-inline">Telefon Kunde: </span>
            {chosen.clientPhone ? <CallButton phone={chosen.clientPhone} size="compact-xs" /> : '–'}
          </Text>
          <Group gap="md" mt={2}>
            {/* Straight to the page of the site, to add or correct its details. */}
            {onGoToSite && (
              <Button size="compact-xs" variant="light" onClick={() => onGoToSite(chosen.id)}>
                Zur Baustelle
              </Button>
            )}
            <SiteWayButtons site={chosen} size="compact-xs" />
          </Group>
        </div>
      )}
      {creating && (
        <SiteForm
          title="Neue Baustelle"
          initial={newSite}
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
