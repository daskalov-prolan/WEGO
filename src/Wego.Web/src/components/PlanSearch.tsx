import { ActionIcon, CloseButton, Select, Text } from '@mantine/core'
import { useState } from 'react'
import type { Site } from '../api/types'
import { formatDate } from '../lib/dates'
import { formatAddress } from '../lib/sites'

interface Props {
  sites: Site[]
  /** The days of each site in the shown plan (this year and phase), sorted. */
  daysOf: (siteId: number) => string[]
  today: string
  year: number
  /** The site searched for and shown in the plan; null: none. */
  found: Site | null
  onFind: (site: Site | null) => void
  /** Shows a day of the found site in the plan. */
  onGo: (day: string) => void
}

/** What a site is found by: its name, client, address and project number. */
function haystack(site: Site) {
  return [site.name, site.client, site.labelProjectNumber, formatAddress(site)].join(' ').toLowerCase()
}

/**
 * Search in the plan for a site, by client (e.g. "Winter"), name or address: the plan jumps to its next
 * days and marks them, so the whole calendar need not be looked through.
 */
export function PlanSearch({ sites, daysOf, today, year, found, onFind, onGo }: Props) {
  const [search, setSearch] = useState('')
  // The day of the found site shown last: the arrows go to its day before or after.
  const [at, setAt] = useState<string | null>(null)
  const go = (day: string) => {
    setAt(day)
    onGo(day)
  }
  const byId = new Map(sites.map((site) => [String(site.id), site]))

  if (found) {
    const days = daysOf(found.id)
    const current = at ?? days.find((day) => day >= today) ?? days.at(-1)
    return (
      <div className="plan-found" role="status" aria-label="Suchergebnis">
        <Text size="sm" fw={600} c="wego.9" truncate>
          {found.name}
        </Text>
        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          {days.length === 0 ? `keine Einsätze ${year}` : `${days.length} ${days.length === 1 ? 'Tag' : 'Tage'} ${year}`}
        </Text>
        {days.length > 1 && (
          <>
            <ActionIcon
              variant="default"
              size="sm"
              aria-label="Voriger Tag der Baustelle"
              disabled={!current || days[0] >= current}
              onClick={() => go(days.findLast((day) => day < current!)!)}
            >
              ‹
            </ActionIcon>
            <ActionIcon
              variant="default"
              size="sm"
              aria-label="Nächster Tag der Baustelle"
              disabled={!current || days.at(-1)! <= current}
              onClick={() => go(days.find((day) => day > current!)!)}
            >
              ›
            </ActionIcon>
          </>
        )}
        <CloseButton size="sm" aria-label="Suche beenden" onClick={() => onFind(null)} />
      </div>
    )
  }

  return (
    <Select
      size="sm"
      w="100%"
      aria-label="Im Plan suchen"
      placeholder="Suchen: Kunde, Baustelle, Adresse"
      searchable
      value={null}
      searchValue={search}
      onSearchChange={setSearch}
      nothingFoundMessage="Keine Baustelle gefunden"
      limit={12}
      onChange={(id) => {
        const site = id === null ? undefined : byId.get(id)
        if (!site) return
        setSearch('')
        const days = daysOf(site.id)
        setAt(days.find((day) => day >= today) ?? days.at(-1) ?? null)
        onFind(site)
      }}
      // Cancelled sites are planned nowhere any more.
      data={sites.filter((site) => site.status !== 'Storniert').map((site) => ({ value: String(site.id), label: site.name }))}
      filter={({ options, search: typed }) => {
        const needle = typed.trim().toLowerCase()
        if (!needle) return []
        const matches = options.filter((option) => 'value' in option && haystack(byId.get(option.value)!).includes(needle))
        // Sites with days in the shown plan first.
        const planned = (option: (typeof options)[number]) => 'value' in option && daysOf(Number(option.value)).length > 0
        return [...matches.filter(planned), ...matches.filter((option) => !planned(option))]
      }}
      renderOption={({ option }) => {
        const site = byId.get(option.value)!
        const days = daysOf(site.id)
        const next = days.find((day) => day >= today) ?? days.at(-1)
        const details = [site.client !== site.name ? site.client : null, formatAddress(site)].filter(Boolean).join(' · ')
        return (
          <div>
            <Text size="sm">{option.label}</Text>
            {details && (
              <Text size="xs" c="dimmed">
                {details}
              </Text>
            )}
            <Text size="xs" c={next ? 'wego.7' : 'dimmed'}>
              {next
                ? `${days.length} ${days.length === 1 ? 'Tag' : 'Tage'} ${year}, ${next >= today ? 'nächster' : 'zuletzt'} ${formatDate(next)}`
                : `keine Einsätze ${year}`}
            </Text>
          </div>
        )
      }}
      comboboxProps={{ withinPortal: true, width: 340, position: 'bottom-start' }}
    />
  )
}
