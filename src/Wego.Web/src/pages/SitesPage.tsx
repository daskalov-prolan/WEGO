import { Alert, Badge, Button, Group, Table, Text, TextInput, Title, UnstyledButton } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useMemo, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Site } from '../api/types'
import { SiteForm } from '../components/SiteForm'
import { formatDate, todayIso } from '../lib/dates'
import { emptySite, formatAddress } from '../lib/sites'

type SortKey = 'name' | 'client' | 'plannedStart' | 'plannedEnd'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'client', label: 'Auftraggeber' },
  { key: 'plannedStart', label: 'Geplanter Start' },
  { key: 'plannedEnd', label: 'Geplantes Ende' },
]

function compare(a: Site, b: Site, key: SortKey): number {
  const left = a[key]
  const right = b[key]
  // Sites without the value come last, whichever the direction.
  if (!left || !right) return left ? -1 : right ? 1 : a.name.localeCompare(b.name, 'de')
  return left.localeCompare(right, 'de') || a.name.localeCompare(b.name, 'de')
}

function status(site: Site, today: string): { label: string; color: string } | null {
  if (site.plannedEnd && site.plannedEnd < today) return { label: 'abgeschlossen', color: 'gray' }
  if (site.plannedStart && site.plannedStart <= today) return { label: 'läuft', color: 'green' }
  if (site.plannedStart) return { label: 'geplant', color: 'wego' }
  return null
}

/**
 * Planner-only: all construction sites, sorted by planned start by default. Sorted by a date, the list
 * opens where the sites begin that start after today.
 */
export function SitesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'plannedStart', descending: false })
  const [creating, setCreating] = useState(false)
  const today = todayIso()

  useEffect(() => {
    api.sites().then(setSites, (e) => setError(messageOf(e)))
  }, [])

  const needle = search.trim().toLowerCase()
  const rows = useMemo(() => {
    const found = needle
      ? sites.filter((site) =>
          [site.name, site.client, formatAddress(site)].join(' ').toLowerCase().includes(needle),
        )
      : sites
    const sorted = [...found].sort((a, b) => compare(a, b, sort.key))
    if (!sort.descending) return sorted
    // Descending, but still with the empty values at the end.
    const withValue = sorted.filter((site) => site[sort.key])
    return [...withValue.reverse(), ...sorted.filter((site) => !site[sort.key])]
  }, [sites, needle, sort])

  // Sorted by a date: jump to the first site whose planned start lies after today.
  const firstUpcoming =
    sort.key === 'plannedStart' || sort.key === 'plannedEnd'
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
          placeholder="Name, Auftraggeber oder Adresse"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={320}
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
              <Table.Th>Adresse</Table.Th>
              <Table.Th>Stand</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((site) => {
              const state = status(site, today)
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
                  <Table.Td>{site.client}</Table.Td>
                  <Table.Td>{site.plannedStart && formatDate(site.plannedStart)}</Table.Td>
                  <Table.Td>{site.plannedEnd && formatDate(site.plannedEnd)}</Table.Td>
                  <Table.Td>{formatAddress(site)}</Table.Td>
                  <Table.Td>
                    {state && (
                      <Badge variant="light" color={state.color}>
                        {state.label}
                      </Badge>
                    )}
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
