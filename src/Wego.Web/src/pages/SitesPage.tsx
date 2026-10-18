import { Alert, Button, Group, SegmentedControl, Table, Text, TextInput, Title, UnstyledButton } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useMemo, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Entry, Site } from '../api/types'
import { SiteActivities } from '../components/SiteActivities'
import { SiteForm } from '../components/SiteForm'
import { StatusBadge } from '../components/SiteStatus'
import { isOpen } from '../lib/activities'
import { formatDate, todayIso } from '../lib/dates'
import { emptySite, formatAddress } from '../lib/sites'
import { openTasksBySite } from '../lib/tasks'

type SortKey = 'name' | 'plannedStart'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'plannedStart', label: 'Geplanter Start' },
]

function compare(a: Site, b: Site, key: SortKey): number {
  const left = a[key]
  const right = b[key]
  // Sites without the value come last, whichever the direction.
  if (!left || !right) return left ? -1 : right ? 1 : a.name.localeCompare(b.name, 'de')
  return left.localeCompare(right, 'de') || a.name.localeCompare(b.name, 'de')
}

/**
 * Planner-only: all construction sites with their status and the activities still to plan, sorted by planned
 * start by default; then the list opens where the sites begin that start after today.
 */
export function SitesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'plannedStart', descending: false })
  const [creating, setCreating] = useState(false)
  const [show, setShow] = useState<'open' | 'all'>('open')
  const today = todayIso()

  useEffect(() => {
    api.sites().then(setSites, (e) => setError(messageOf(e)))
  }, [])

  // Which activities are planned already: the entries of last year, this year and the next one.
  const [entries, setEntries] = useState<Entry[]>([])
  useEffect(() => {
    const year = Number(today.slice(0, 4))
    Promise.all([year - 1, year, year + 1].map((one) => api.plan(one))).then(
      (plans) => setEntries(plans.flatMap((plan) => plan.entries ?? [])),
      (e) => setError(messageOf(e)),
    )
  }, [today])
  const open = useMemo(() => openTasksBySite(sites, entries), [sites, entries])

  const needle = search.trim().toLowerCase()
  const rows = useMemo(() => {
    const shown = show === 'open' ? sites.filter((site) => isOpen(site.status)) : sites
    const found = needle
      ? shown.filter((site) =>
          [site.name, site.client, site.labelProjectNumber, formatAddress(site)].join(' ').toLowerCase().includes(needle),
        )
      : shown
    const sorted = [...found].sort((a, b) => compare(a, b, sort.key))
    if (!sort.descending) return sorted
    // Descending, but still with the empty values at the end.
    const withValue = sorted.filter((site) => site[sort.key])
    return [...withValue.reverse(), ...sorted.filter((site) => !site[sort.key])]
  }, [sites, needle, sort, show])

  // Sorted by the planned start: jump to the first site whose planned start lies after today.
  const firstUpcoming =
    sort.key === 'plannedStart'
      ? rows.find((site) => site.plannedStart && site.plannedStart > today)
      : undefined
  useEffect(() => {
    if (firstUpcoming) document.getElementById(`site-row-${firstUpcoming.id}`)?.scrollIntoView({ block: 'start' })
  }, [firstUpcoming, sort])

  const sortBy = (key: SortKey) =>
    setSort((current) => ({ key, descending: current.key === key ? !current.descending : false }))

  return (
    <div className="page">
      <Group justify="space-between" mb="md">
        <Title order={2}>Baustellen</Title>
        <Button onClick={() => setCreating(true)}>+ Neue Baustelle</Button>
      </Group>

      <Group gap="sm" mb="sm" align="flex-end">
        <TextInput
          label="Suchen"
          type="search"
          placeholder="Name, Auftraggeber, Projektnummer, Adresse"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={320}
        />
        <SegmentedControl
          value={show}
          onChange={(value) => setShow(value as 'open' | 'all')}
          data={[
            { value: 'open', label: 'Unerledigte' },
            { value: 'all', label: 'Alle' },
          ]}
        />
        <Text size="sm" c="dimmed">
          {rows.length} von {sites.length} Baustellen
        </Text>
      </Group>

      {error && (
        <Alert color="red" variant="light" mb="md">
          {error}
        </Alert>
      )}

      <Table.ScrollContainer minWidth={760}>
        <Table striped highlightOnHover withTableBorder stickyHeader className="sites-table">
          <Table.Thead>
            <Table.Tr>
              {COLUMNS.map((column) => (
                <Table.Th key={column.key}>
                  <UnstyledButton onClick={() => sortBy(column.key)} className="sort-button">
                    {column.label}
                    {sort.key === column.key && <span aria-hidden> {sort.descending ? '▼' : '▲'}</span>}
                  </UnstyledButton>
                </Table.Th>
              ))}
              <Table.Th w={120}>Status</Table.Th>
              <Table.Th>Tätigkeiten</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((site) => {
              return (
                <Table.Tr
                  key={site.id}
                  id={`site-row-${site.id}`}
                  className={site === firstUpcoming ? 'site-row first-upcoming' : 'site-row'}
                  onClick={() => (window.location.hash = `#/baustellen/${site.id}`)}
                >
                  <Table.Td fw={600}>
                    <a href={`#/baustellen/${site.id}`}>{site.name}</a>
                  </Table.Td>
                  <Table.Td>{site.plannedStart && formatDate(site.plannedStart)}</Table.Td>
                  <Table.Td>
                    <StatusBadge status={site.status} />
                  </Table.Td>
                  <Table.Td>
                    <SiteActivities site={site} open={open.get(site.id) ?? []} />
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {creating && (
        <SiteForm
          title="Neue Baustelle"
          initial={emptySite}
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            const site = await api.createSite(input)
            setSites((current) => [...current, site])
            setCreating(false)
            notifications.show({ message: `Baustelle „${site.name}“ angelegt.`, color: 'green' })
          }}
        />
      )}
    </div>
  )
}
