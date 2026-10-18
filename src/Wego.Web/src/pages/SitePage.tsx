import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  ColorSwatch,
  Group,
  Menu,
  Select,
  SimpleGrid,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState, type ReactNode } from 'react'
import { api, messageOf } from '../api/client'
import type { Site, SiteReport } from '../api/types'
import { SiteForm } from '../components/SiteForm'
import { SiteLocation } from '../components/SiteLocation'
import { SiteMiniPlan } from '../components/SiteMiniPlan'
import { SiteStatusPanel } from '../components/SiteStatus'
import { Sheet } from '../components/Sheet'
import { Stat } from '../components/Stat'
import { ACTIVITIES, activityLabel } from '../lib/activities'
import { formatDate, formatHours, formatTimeRange } from '../lib/dates'
import { formatAddress, toSiteInput } from '../lib/sites'

interface Props {
  year: number
  siteId: number
}

/** One fact of the site in the head: a small label and its value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="site-fact">
      <span className="site-fact-label">{label}</span> {children}
    </span>
  )
}

/** Planner-only: the record of one construction site, and who worked there how many days. */
export function SitePage({ year, siteId }: Props) {
  const [sites, setSites] = useState<Site[]>([])
  const [report, setReport] = useState<SiteReport | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)

  useEffect(() => {
    api.sites().then(setSites, (e) => setError(messageOf(e)))
  }, [])

  useEffect(() => {
    api.siteReport(siteId, year).then(setReport, (e) => setError(messageOf(e)))
  }, [siteId, year])

  const site = sites.find((candidate) => candidate.id === siteId)
  const current = report && report.siteId === siteId && report.year === year ? report : null
  const address = site && formatAddress(site)

  // How far the job has come: employee days per activity, in the order of the job.
  const byActivity = ACTIVITIES.map((activity) => ({
    ...activity,
    days: current?.entries.filter((entry) => entry.activity === activity.value).length ?? 0,
    last: current?.entries.filter((entry) => entry.activity === activity.value).at(-1)?.date,
  })).filter((row) => row.days > 0)

  const merge = async () => {
    if (!site || !mergeTarget) return
    const target = sites.find((candidate) => String(candidate.id) === mergeTarget)
    if (!target || !window.confirm(`„${site.name}“ mit „${target.name}“ zusammenführen? Alle Einsätze wandern dorthin, „${site.name}“ wird gelöscht.`)) return
    try {
      await api.mergeSite(site.id, target.id)
      notifications.show({ message: `Zusammengeführt in „${target.name}“.`, color: 'green' })
      window.location.hash = `#/baustellen/${target.id}`
      setSites((list) => list.filter((candidate) => candidate.id !== site.id))
      setMergeTarget(null)
      setMerging(false)
    } catch (e) {
      setError(messageOf(e))
    }
  }

  const remove = async () => {
    if (!site || !window.confirm(`Baustelle „${site.name}“ löschen?`)) return
    try {
      await api.deleteSite(site.id)
      notifications.show({ message: 'Baustelle gelöscht.' })
      window.location.hash = '#/baustellen'
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <div className="page">
      {/* A narrow head that stays at the top while the plan below is scrolled. */}
      <div className="site-head">
        <Anchor size="sm" className="site-head-back" onClick={() => window.history.back()}>
          ‹ Zurück
        </Anchor>
        <Title order={3} className="site-head-name" title={site?.name}>
          {site?.name ?? report?.siteName ?? 'Baustelle'}
        </Title>
        {site && (
          <>
            <SiteStatusPanel
              site={site}
              canEdit
              onChanged={(saved) => setSites((list) => list.map((candidate) => (candidate.id === saved.id ? saved : candidate)))}
            />
            <span className="site-head-facts">
              {site.client && site.client !== site.name && <Fact label="Auftraggeber">{site.client}</Fact>}
              {address && (
                <Fact label="Adresse">
                  <SiteLocation location={address} />
                </Fact>
              )}
              {(site.plannedStart || site.plannedEnd) && (
                <Fact label="Geplant">
                  {site.plannedStart ? formatDate(site.plannedStart) : '?'} – {site.plannedEnd ? formatDate(site.plannedEnd) : '?'}
                </Fact>
              )}
              {site.labelProjectNumber && <Fact label="Label">{site.labelProjectNumber}</Fact>}
              {site.description && (
                <Text size="xs" c="dimmed" className="site-head-description" title={site.description}>
                  {site.description}
                </Text>
              )}
            </span>
            <Group gap={4} wrap="nowrap" className="site-head-actions">
              <Button size="compact-sm" variant="light" onClick={() => setEditing(true)}>
                Bearbeiten
              </Button>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray" aria-label="Weitere Aktionen">
                    ⋯
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item component="a" href="#/baustellen">
                    Alle Baustellen
                  </Menu.Item>
                  <Menu.Item onClick={() => setMerging(true)}>Zusammenführen …</Menu.Item>
                  {current && current.entries.length === 0 && (
                    <Menu.Item color="red" onClick={remove}>
                      Löschen
                    </Menu.Item>
                  )}
                </Menu.Dropdown>
              </Menu>
            </Group>
          </>
        )}
      </div>

      {error && (
        <Alert color="red" variant="light" my="sm">
          {error}
        </Alert>
      )}

      {merging && site && (
        <Sheet title="Doppelt angelegt? Zusammenführen" onClose={() => setMerging(false)} size="md">
          <Text size="sm" mb="sm">
            Alle Einsätze von „{site.name}“ wandern zur gewählten Baustelle, „{site.name}“ wird danach gelöscht.
          </Text>
          <Group gap="xs" align="flex-end">
            <Select
              label="Zusammenführen mit"
              placeholder="Baustelle wählen"
              searchable
              clearable
              limit={30}
              style={{ flex: 1 }}
              value={mergeTarget}
              onChange={setMergeTarget}
              data={sites
                .filter((candidate) => candidate.id !== site.id)
                .map((candidate) => ({ value: String(candidate.id), label: candidate.name }))}
              comboboxProps={{ withinPortal: false }}
              data-autofocus
            />
            <Button disabled={!mergeTarget} onClick={merge}>
              Zusammenführen
            </Button>
          </Group>
        </Sheet>
      )}

      {editing && site && (
        <SiteForm
          title="Baustelle bearbeiten"
          initial={toSiteInput(site)}
          onClose={() => setEditing(false)}
          onSave={async (input) => {
            const saved = await api.updateSite(site.id, input)
            setSites((list) => list.map((candidate) => (candidate.id === saved.id ? saved : candidate)))
            setEditing(false)
            notifications.show({ message: 'Baustelle gespeichert.', color: 'green' })
          }}
        />
      )}

      {site && (
        <SiteMiniPlan
          site={site}
          canEdit
          onSiteChange={(saved) => setSites((list) => list.map((candidate) => (candidate.id === saved.id ? saved : candidate)))}
        />
      )}

      <Title order={4} mb="xs">
        Einsätze {year}
      </Title>      {current && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm" mb="xs">
            <Stat value={current.totalDays} label={`Einsatztage ${current.year}`} />
            <Stat value={current.employees.length} label="Mitarbeiter" />
            <Stat value={formatHours(current.totalHours)} label="Stunden laut Zeitfenstern" />
          </SimpleGrid>
          <Text size="sm" c="dimmed" mb="lg">
            Ein Einsatztag ist ein Tag, an dem ein Mitarbeiter auf dieser Baustelle eingeplant war, auch bei geteilten
            Tagen. Stunden werden nur aus Einträgen mit Zeitfenster berechnet.
          </Text>

          <Title order={4} mb="xs">
            Nach Mitarbeiter
          </Title>
          <Table.ScrollContainer minWidth={380} mb="lg">
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Mitarbeiter</Table.Th>
                  <Table.Th ta="right">Einsatztage</Table.Th>
                  <Table.Th ta="right">Stunden</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {current.employees.map((row) => (
                  <Table.Tr key={row.id}>
                    <Table.Td>
                      <Anchor href={`#/mitarbeiter/${row.id}`}>{row.name}</Anchor>
                    </Table.Td>
                    <Table.Td ta="right">{row.days}</Table.Td>
                    <Table.Td ta="right">{formatHours(row.hours)}</Table.Td>
                  </Table.Tr>
                ))}
                {current.employees.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={3}>Keine Einsätze in {current.year}.</Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
              <Table.Tfoot>
                <Table.Tr>
                  <Table.Th>Summe</Table.Th>
                  <Table.Th ta="right">{current.totalDays}</Table.Th>
                  <Table.Th ta="right">{formatHours(current.totalHours)}</Table.Th>
                </Table.Tr>
              </Table.Tfoot>
            </Table>
          </Table.ScrollContainer>

          {byActivity.length > 0 && (
            <>
              <Title order={4} mb="xs">
                Nach Tätigkeit
              </Title>
              <Table.ScrollContainer minWidth={380} mb="lg">
                <Table withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Tätigkeit</Table.Th>
                      <Table.Th ta="right">Einsatztage</Table.Th>
                      <Table.Th>Zuletzt</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {byActivity.map((row) => (
                      <Table.Tr key={row.value}>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            <ColorSwatch color={row.background} size={12} withShadow={false} />
                            {row.label}
                          </Group>
                        </Table.Td>
                        <Table.Td ta="right">{row.days}</Table.Td>
                        <Table.Td>{row.last && formatDate(row.last)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </>
          )}

          <Title order={4} mb="xs">
            Alle Einsätze
          </Title>
          <Table.ScrollContainer minWidth={380}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Tag</Table.Th>
                  <Table.Th>Mitarbeiter</Table.Th>
                  <Table.Th>Tätigkeit</Table.Th>
                  <Table.Th>Zeitfenster</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {current.entries.map((entry) => (
                  <Table.Tr key={entry.id}>
                    <Table.Td>{formatDate(entry.date)}</Table.Td>
                    <Table.Td>{entry.employeeName}</Table.Td>
                    <Table.Td>{activityLabel(entry.activity)}</Table.Td>
                    <Table.Td>{formatTimeRange(entry) || 'ganztägig'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}
    </div>
  )
}
