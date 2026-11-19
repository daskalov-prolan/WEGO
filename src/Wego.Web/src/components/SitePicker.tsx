import { Button, Group, Select, Text, type ComboboxItem, type ComboboxParsedItemGroup } from '@mantine/core'
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
}

/** The heading of the sites still in the offer, at the end of the list. */
export const OFFER_GROUP = 'Noch im Angebot (nur reservieren)'

/** Choice of a construction site, searchable by name, client and address; new sites are created on the spot. */
export function SitePicker({ sites, value, onChange, onCreate, onGoToSite, newSite = emptySite, label, required }: Props) {
  const [creating, setCreating] = useState(false)
  const byId = new Map(sites.map((site) => [String(site.id), site]))
  const chosen = value === null ? undefined : byId.get(String(value))
  const chosenAddress = chosen && formatAddress(chosen)
  // What the chosen one is: the field and the button to its page are named after it.
  const kind = chosen?.isTentative ? 'Termin' : chosen?.isService ? 'Serviceauftrag' : 'Baustelle'
  // Done and cancelled sites are not offered for new work, nor service calls (each is for its one day); one
  // chosen before stays visible. Sites still in the offer come last, under a heading of their own: they can only
  // be reserved for a customer who has not said yes.
  const offered = sites.filter((site) => (isOpen(site.status) && !site.isService) || site.id === value)
  const inOffer = (site: Site) => site.status === 'Angebot' && !site.isTentative
  const item = (site: Site) => ({ value: String(site.id), label: inOffer(site) ? `${site.name} (Angebot)` : site.name })
  const working = offered.filter((site) => !inOffer(site)).map(item)
  const reserving = offered.filter(inOffer).map(item)
  const data = reserving.length === 0 ? working : [
    ...(working.length > 0 ? [{ group: 'Baustellen', items: working }] : []),
    { group: OFFER_GROUP, items: reserving },
  ]
  // What is typed searches name, client, project number and address; the names that begin with it come first.
  const search = (items: ComboboxItem[], needle: string) => {
    const matches = items.filter((option) => {
      const site = byId.get(option.value)
      return !needle || [site?.name, site?.client, site?.labelProjectNumber, site && formatAddress(site)].join(' ').toLowerCase().includes(needle)
    })
    const begins = (option: ComboboxItem) => byId.get(option.value)?.name.toLowerCase().startsWith(needle) ?? false
    return needle ? [...matches.filter(begins), ...matches.filter((option) => !begins(option))] : matches
  }

  return (
    <>
      <Group gap={6} align="flex-end" wrap="nowrap">
        <Select
          label={label ?? kind}
          placeholder="Baustelle suchen"
          searchable
          clearable
          required={required}
          limit={30}
          style={{ flex: 1 }}
          value={value === null ? null : String(value)}
          onChange={(next) => onChange(next === null ? null : Number(next))}
          data={data}
          filter={({ options, search: typed }) => {
            const needle = typed.trim().toLowerCase()
            const plain = options.filter((option): option is ComboboxItem => 'value' in option)
            const groups = options
              .filter((option): option is ComboboxParsedItemGroup => 'group' in option)
              .map((group) => ({ ...group, items: search(group.items, needle) }))
              .filter((group) => group.items.length > 0)
            return [...search(plain, needle), ...groups]
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
