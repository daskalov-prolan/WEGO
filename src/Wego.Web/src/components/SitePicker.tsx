import { ActionIcon, Button, Group, Select, Text, Tooltip } from '@mantine/core'
import { useState } from 'react'
import type { Site, SiteInput } from '../api/types'
import { isOpen } from '../lib/activities'
import { clientPhones, emptySite, formatAddress } from '../lib/sites'
import { SiteForm } from './SiteForm'
import { SiteWayButtons } from './SiteActions'

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
  /**
   * Small, for the day editor: the field without a heading, address, phone and what is to be done in short lines
   * with a sign in front, the ways to the site as round buttons beside them.
   */
  compact?: boolean
}

/** Choice of a construction site, searchable by name, client and address; new sites are created on the spot. */
export function SitePicker({ sites, value, onChange, onCreate, onGoToSite, newSite = emptySite, label, required, compact = false }: Props) {
  const [creating, setCreating] = useState(false)
  const byId = new Map(sites.map((site) => [String(site.id), site]))
  const chosen = value === null ? undefined : byId.get(String(value))
  const chosenAddress = chosen && formatAddress(chosen)
  // What the chosen one is: the field and the button to its page are named after it.
  const kind = chosen?.isTentative ? 'Termin' : chosen?.isService ? 'Serviceauftrag' : 'Baustelle'

  return (
    <>
      <Group gap={6} align="flex-end" wrap="nowrap">
        <Select
          label={compact ? undefined : label ?? kind}
          aria-label={compact ? label ?? kind : undefined}
          placeholder="Baustelle suchen"
          searchable
          clearable
          required={required}
          limit={30}
          style={{ flex: 1 }}
          value={value === null ? null : String(value)}
          onChange={(next) => onChange(next === null ? null : Number(next))}
          // Done and cancelled sites are not offered for new work, nor service calls (each is for its one day);
          // one chosen before stays visible.
          data={sites
            .filter((site) => (isOpen(site.status) && !site.isService) || site.id === value)
            .map((site) => ({ value: String(site.id), label: site.status === 'Angebot' && !site.isTentative ? `${site.name} (Angebot)` : site.name }))}
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
      {chosen && compact && (
        <div className="site-contact compact">
          <div className="site-contact-info">
            {chosenAddress && <Text size="xs" className="site-line site-address">{chosenAddress}</Text>}
            {clientPhones(chosen).length > 0 && <Text size="xs" className="site-line site-phone">{clientPhones(chosen).join(' · ')}</Text>}
            {/* A service call: what is to be done, as entered when it was created. */}
            {chosen.isService && chosen.description?.trim() && (
              <Text size="xs" className="site-line site-todo service-todo">{chosen.description}</Text>
            )}
          </div>
          <Group gap={6} wrap="nowrap" className="site-contact-icons">
            {chosenAddress && (
              <Tooltip label="Navigation starten">
                <ActionIcon component="a" variant="light" radius="xl" aria-label="Navigation starten" target="_blank" rel="noreferrer"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(chosenAddress)}`}>
                  🧭
                </ActionIcon>
              </Tooltip>
            )}
            {chosenAddress && chosen.street && (
              <Tooltip label="Auf Karte anzeigen">
                <ActionIcon component="a" variant="light" radius="xl" aria-label="Auf Karte anzeigen" target="_blank" rel="noreferrer"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(chosenAddress)}`}>
                  🗺
                </ActionIcon>
              </Tooltip>
            )}
            {onGoToSite && (
              <Tooltip label={kind === 'Baustelle' ? 'Zur Baustelle' : kind === 'Termin' ? 'Zum Termin' : 'Zum Serviceauftrag'}>
                <ActionIcon variant="light" radius="xl" onClick={() => onGoToSite(chosen.id)}
                  aria-label={kind === 'Baustelle' ? 'Zur Baustelle' : kind === 'Termin' ? 'Zum Termin' : 'Zum Serviceauftrag'}>
                  ↗
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </div>
      )}
      {chosen && !compact && (
        <div className="site-contact">
          {/* At the left what is known, at the right all buttons together: calmer than a button behind every line. */}
          <div className="site-contact-info">
            <Text size="sm">
              <span className="muted-inline">Adresse: </span>
              {chosenAddress ?? '–'}
            </Text>
            <Text size="sm">
              <span className="muted-inline">Telefon Kunde: </span>
              {clientPhones(chosen).join(' · ') || '–'}
            </Text>
            {/* A service call: what is to be done, as entered when it was created. */}
            {chosen.isService && chosen.description?.trim() && (
              <Text size="sm" className="service-todo">
                <span className="muted-inline">Was ist zu tun: </span>
                {chosen.description}
              </Text>
            )}
          </div>
          <div className="site-contact-actions">
            <SiteWayButtons site={chosen} size="compact-xs" />
            <Group gap="xs" justify="flex-end">
              {/* No button that calls here: the planners plan at the desk, the number stands at the left. */}
              {/* Straight to the page of the site, to add or correct its details. */}
              {onGoToSite && (
                <Button size="compact-xs" onClick={() => onGoToSite(chosen.id)}>
                  {kind === 'Baustelle' ? 'Zur Baustelle' : kind === 'Termin' ? 'Zum Termin' : 'Zum Serviceauftrag'}
                </Button>
              )}
            </Group>
          </div>
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
