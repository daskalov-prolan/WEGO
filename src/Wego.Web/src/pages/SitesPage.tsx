import { Alert, Button, Group, SegmentedControl, Select, Table, Text, TextInput, Title, UnstyledButton } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Planner, Site, SiteMapLocation, SiteStatus } from '../api/types'
import { SiteForm } from '../components/SiteForm'
import { LazySitesMap } from '../components/SiteMapLink'
import { StatusBadge, StatusSlider, TentativeBadge } from '../components/SiteStatus'
import { finishSite, showDoneHint } from '../lib/siteDone'
import { isOpen, SITE_STATUSES } from '../lib/activities'
import { addDays, formatDate, todayIso } from '../lib/dates'
import { emptySite, formatAddress } from '../lib/sites'
import { useIsPhone } from '../lib/useIsPhone'
import { StandardFlowDialog } from '../components/StandardFlowDialog'
import { CallButton, SiteWayButtons } from '../components/SiteActions'

/** The telephone number of the customer as a button that dials it, without opening the site. */
function PhoneLink({ phone }: { phone: string }) {
  return <CallButton phone={phone} size="compact-xs" />
}

type SortKey = 'name' | 'plannedStart'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'plannedStart', label: 'Geplanter Start' },
]

/**
 * Which sites the list shows: the active ones, all, those in one status, or those starting in a period (by
 * their planned start).
 */
type Show = 'active' | 'all' | 'last6' | 'service' | 'tentative' | `year:${number}` | `status:${SiteStatus}`

/** Active: the construction has begun (planned start today or before) and the site is not done yet. */
const isActive = (site: Site, today: string) => isOpen(site.status) && !!site.plannedStart && site.plannedStart <= today

function shows(site: Site, show: Show, today: string): boolean {
  // Cancelled sites (from before there was no cancelling any more) are not shown at all.
  if (site.status === 'Storniert') return false
  // Service calls only on their own: they are no sites to follow.
  if (show === 'service') return !!site.isService
  if (site.isService) return false
  // Appointments not confirmed yet: with the open sites (also the usual view of the Bauphase), and on their own.
  if (show === 'tentative') return !!site.isTentative
  if (site.isTentative) return ['active', 'all', 'status:Angebot', 'status:Bauphase'].includes(show)
  if (show === 'all') return true
  if (show === 'active') return isActive(site, today)
  if (show.startsWith('status:')) return site.status === show.slice(7)
  if (!site.plannedStart) return false
  if (show === 'last6') return site.plannedStart >= addDays(today, -183) && site.plannedStart <= today
  return site.plannedStart.startsWith(show.slice(5))
}

/** How the list is grouped: not at all, by the planner in charge, or by status. */
type Grouping = 'none' | 'planner' | 'status'

function compare(a: Site, b: Site, key: SortKey): number {
  const left = a[key]
  const right = b[key]
  // Sites without the value come last, whichever the direction.
  if (!left || !right) return left ? -1 : right ? 1 : a.name.localeCompare(b.name, 'de')
  return left.localeCompare(right, 'de') || a.name.localeCompare(b.name, 'de')
}

/**
 * Planner-only: all construction sites with their status, the planner in charge, address and phone of the
 * customer, sorted by planned start by default; then the list opens where the sites begin that start after today.
 */
export function SitesPage({ canFinish = false }: { canFinish?: boolean }) {
  const [sites, setSites] = useState<Site[]>([])
  // A new site with its Baubeginn: asked whether the standard flow goes into the plan.
  const [flowSite, setFlowSite] = useState<Site | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'plannedStart', descending: false })
  const [creating, setCreating] = useState(false)
  // The construction phase first, whenever it starts.
  const [show, setShow] = useState<Show>('status:Bauphase')
  const [grouping, setGrouping] = useState<Grouping>('none')
  // The sites shown as a list or on the map of Berlin.
  const [view, setView] = useState<'list' | 'map'>('list')
  const [locations, setLocations] = useState<Map<number, SiteMapLocation>>(new Map())
  const [pending, setPending] = useState(0)
  useEffect(() => {
    if (view !== 'map') return
    // A few addresses are looked up per call: ask again until all are known.
    let stopped = false
    const load = async () => {
      try {
        const answer = await api.siteLocations()
        if (stopped) return
        setLocations(new Map(answer.locations.map((location) => [location.siteId, location])))
        setPending(answer.pending)
        if (answer.pending > 0) window.setTimeout(load, 500)
      } catch (e) {
        if (!stopped) setError(messageOf(e))
      }
    }
    void load()
    return () => {
      stopped = true
    }
  }, [view])
  const today = todayIso()
  const isPhone = useIsPhone()

  useEffect(() => {
    api.sites().then(setSites, (e) => setError(messageOf(e)))
  }, [])

  const [planners, setPlanners] = useState<Planner[]>([])
  useEffect(() => {
    api.planners().then(setPlanners, (e) => setError(messageOf(e)))
  }, [])
  const plannerName = useCallback(
    (site: Site) => planners.find((planner) => planner.id === site.responsiblePlannerId)?.name ?? '',
    [planners],
  )

  const needle = search.trim().toLowerCase()
  const rows = useMemo(() => {
    const shown = sites.filter((site) => shows(site, show, today))
    const found = needle
      ? shown.filter((site) =>
          [site.name, site.client, site.labelProjectNumber, formatAddress(site), site.clientPhone, plannerName(site)]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : shown
    const sorted = [...found].sort((a, b) => compare(a, b, sort.key))
    if (!sort.descending) return sorted
    // Descending, but still with the empty values at the end.
    const withValue = sorted.filter((site) => site[sort.key])
    return [...withValue.reverse(), ...sorted.filter((site) => !site[sort.key])]
  }, [sites, needle, sort, show, today, plannerName])

  // The years to choose: this one, the next one and every year a site starts in, latest first.
  const thisYear = Number(today.slice(0, 4))
  const years = [...new Set([thisYear + 1, thisYear, ...sites.flatMap((site) => (site.plannedStart ? [Number(site.plannedStart.slice(0, 4))] : []))])]
    .sort((a, b) => b - a)

  // Done (with the summary as a PDF) or back into the construction phase, right from the list: Planer G only.
  const setDone = async (site: Site, done: boolean) => {
    if (!canFinish) {
      showDoneHint()
      return
    }
    try {
      const saved = done ? await finishSite(site) : await api.changeSiteStatus(site.id, 'Bauphase')
      if (!saved) return
      setSites((list) => list.map((candidate) => (candidate.id === saved.id ? saved : candidate)))
      if (!done) notifications.show({ message: `„${saved.name}“ ist wieder in der Bauphase.`, color: 'green' })
    } catch (e) {
      setError(messageOf(e))
    }
  }
  // An offer goes into the construction phase from the list as well (not an appointment still to be confirmed).
  const startBuilding = async (site: Site) => {
    if (!window.confirm(`„${site.name}“: Bauphase beginnen?`)) return
    try {
      const saved = await api.changeSiteStatus(site.id, 'Bauphase')
      setSites((list) => list.map((candidate) => (candidate.id === saved.id ? saved : candidate)))
      notifications.show({ message: `„${saved.name}“ ist jetzt in der Bauphase.`, color: 'green' })
    } catch (e) {
      setError(messageOf(e))
    }
  }
  // Only a site in the construction phase can be done, and only a done one goes back; an offer begins building.
  const doneSwitch = (site: Site) =>
    site.status === 'Angebot' && !site.isTentative ? (
      <Button
        size="compact-xs"
        color="wegoRed"
        variant="light"
        onClick={(event) => {
          event.stopPropagation()
          void startBuilding(site)
        }}
      >
        Bauphase beginnen
      </Button>
    ) : (
      (site.status === 'Bauphase' || site.status === 'Abgeschlossen') && (
        <StatusSlider site={site} size="xs" caps onChange={(status) => setDone(site, status === 'Abgeschlossen').catch(() => {})} />
      )
    )

  // The rows in groups, in the order of the sort within each group.
  const groups = useMemo(() => {
    if (grouping === 'none') return [{ key: 'all', label: '', sites: rows }]
    const keyOf = (site: Site) => (grouping === 'planner' ? plannerName(site) : site.status)
    const keys =
      grouping === 'planner'
        ? [...new Set(rows.map(keyOf))].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b, 'de')))
        : SITE_STATUSES.map((status) => status.value).filter((status) => rows.some((site) => site.status === status))
    return keys.map((key) => ({
      key: key || 'none',
      label: grouping === 'planner' ? key || 'Ohne Zuständigkeit' : (SITE_STATUSES.find((status) => status.value === key)?.label ?? key),
      sites: rows.filter((site) => keyOf(site) === key),
    }))
  }, [rows, grouping, plannerName])

  // Sorted by the planned start: a line above the first site whose planned start lies after today. The list
  // opens at its beginning, it does not jump there.
  const firstUpcoming =
    sort.key === 'plannedStart'
      ? rows.find((site) => site.plannedStart && site.plannedStart > today)
      : undefined

  // The sites shown that have a place on the map.
  const points = useMemo(
    () => rows.flatMap((site) => (locations.has(site.id) ? [{ site, location: locations.get(site.id)! }] : [])),
    [rows, locations],
  )

  const sortBy = (key: SortKey) =>
    setSort((current) => ({ key, descending: current.key === key ? !current.descending : false }))

  return (
    <div className="page">
      <Group justify="space-between" align="flex-start" mb="md">
        <div>
          <Title order={2} mb={4} className="page-title">
            Baustellen
          </Title>
          <Text c="dimmed">
            {rows.length} von {sites.length} Baustellen
          </Text>
        </div>
        <Button onClick={() => setCreating(true)}>+ Neue Baustelle</Button>
      </Group>

      <Group gap="sm" mb="sm" align="flex-end">
        <TextInput
          label="Suchen"
          type="search"
          placeholder="Name, Auftraggeber, Adresse, Telefon, Planer"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={320}
        />
        <Select
          label="Anzeigen"
          w={250}
          value={show}
          onChange={(value) => value && setShow(value as Show)}
          allowDeselect={false}
          data={[
            { value: 'active', label: 'Aktive Baustellen' },
            { value: 'all', label: 'Alle Baustellen' },
            ...SITE_STATUSES.filter((status) => status.value !== 'Storniert').map((status) => ({
              value: `status:${status.value}`,
              label: `Status ${status.label}`,
            })),
            { value: 'last6', label: 'Start in den letzten 6 Monaten' },
            { value: 'service', label: 'Serviceeinsätze' },
            { value: 'tentative', label: 'Unbestätigte Termine' },
            ...years.map((year) => ({ value: `year:${year}`, label: `Start im Jahr ${year}` })),
          ]}
        />
        <Select
          label="Gruppieren"
          w={190}
          value={grouping}
          onChange={(value) => value && setGrouping(value as Grouping)}
          allowDeselect={false}
          data={[
            { value: 'none', label: 'nicht gruppiert' },
            { value: 'planner', label: 'nach Zuständigkeit' },
            { value: 'status', label: 'nach Status' },
          ]}
        />
        <SegmentedControl
          value={view}
          onChange={(value) => setView(value as 'list' | 'map')}
          data={[
            { value: 'list', label: 'Liste' },
            { value: 'map', label: 'Karte' },
          ]}
        />
      </Group>

      {error && (
        <Alert color="red" variant="light" mb="md">
          {error}
        </Alert>
      )}

      {view === 'map' ? (
        <>
          <Suspense fallback={<Text c="dimmed">Die Karte wird geladen …</Text>}>
            <LazySitesMap points={points} />
          </Suspense>
          <Text size="sm" c="dimmed" mt="xs">
            {pending > 0
              ? `Adressen werden auf der Karte gesucht … (noch ${pending})`
              : `${rows.filter((site) => locations.has(site.id)).length} von ${rows.length} Baustellen auf der Karte; ohne gefundene Adresse fehlen die übrigen.`}
          </Text>
        </>
      ) : isPhone ? (
        // On a phone one card per site instead of the wide table.
        <div className="site-cards">
          {groups.map((group) => (
            <Fragment key={group.key}>
              {group.label && (
                <h3 className="site-group">
                  {group.label} ({group.sites.length})
                </h3>
              )}
              {group.sites.map((site) => (
                <div
                  key={site.id}
                  id={`site-row-${site.id}`}
                  className={site === firstUpcoming ? 'site-card first-upcoming' : 'site-card'}
                  onClick={() => (window.location.hash = `#/baustellen/${site.id}`)}
                >
                  <div className="site-card-head">
                    <a href={`#/baustellen/${site.id}`}>{site.name}</a>
                    {site.isTentative ? <TentativeBadge /> : <StatusBadge status={site.status} />}
                  </div>
                  {formatAddress(site) && <div>{formatAddress(site)}</div>}
                  <SiteWayButtons site={site} size="compact-xs" />
                  <div className="site-card-meta">
                    {site.clientPhone && <PhoneLink phone={site.clientPhone} />}
                    {plannerName(site) && <span>Zuständig: {plannerName(site)}</span>}
                    {site.plannedStart && <span>Start {formatDate(site.plannedStart)}</span>}
                    {doneSwitch(site) && <span className="site-card-done">{doneSwitch(site)}</span>}
                  </div>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table striped highlightOnHover withTableBorder stickyHeader className="brand-table sites-table">
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
                <Table.Th>Zuständig</Table.Th>
                <Table.Th>Adresse</Table.Th>
                <Table.Th>Telefon Kunde</Table.Th>
                <Table.Th>Status setzen</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  {group.label && (
                    <Table.Tr className="group-row">
                      <Table.Td colSpan={7}>
                        {group.label} ({group.sites.length})
                      </Table.Td>
                    </Table.Tr>
                  )}
                  {group.sites.map((site) => {
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
                          {site.isTentative ? <TentativeBadge /> : <StatusBadge status={site.status} />}
                        </Table.Td>
                        <Table.Td>{plannerName(site)}</Table.Td>
                        <Table.Td>{formatAddress(site)}</Table.Td>
                        <Table.Td>{site.clientPhone && <PhoneLink phone={site.clientPhone} />}</Table.Td>
                        <Table.Td>{doneSwitch(site)}</Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Fragment>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

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
            if (site.plannedStart && !site.isService) setFlowSite(site)
          }}
        />
      )}

      {flowSite && <StandardFlowDialog site={flowSite} onClose={() => setFlowSite(null)} />}
    </div>
  )
}
