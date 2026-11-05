import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  ColorSwatch,
  Group,
  Menu,
  Select,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api, ApiError, messageOf } from '../api/client'
import type { Planner, Site, SiteReport } from '../api/types'
import { SiteForm } from '../components/SiteForm'
import { SiteMiniPlan } from '../components/SiteMiniPlan'
import { SiteStatusPanel } from '../components/SiteStatus'
import { SiteSummary } from '../components/SiteSummary'
import { Sheet } from '../components/Sheet'
import { SiteCosting } from '../components/SiteCosting'
import { ACTIVITIES, activityLabel } from '../lib/activities'
import { formatDate, formatTimeRange } from '../lib/dates'
import { toSiteInput } from '../lib/sites'
import { StandardFlowDialog } from '../components/StandardFlowDialog'
import { handOverUndo } from '../lib/undoHandoff'

interface Props {
  /** The year chosen above; the page itself counts over the whole time of the site. */
  year?: number
  siteId: number
  /** Planer G open the pages of the employees from here. */
  canSeeEmployees?: boolean
}

/** Planner-only: the record of one construction site, and who worked there how many days. */
export function SitePage({ siteId, canSeeEmployees = false }: Props) {
  const [sites, setSites] = useState<Site[]>([])
  // A Baubeginn just entered: asked whether the standard flow goes into the plan; drawn anew after it.
  const [flowSite, setFlowSite] = useState<Site | null>(null)
  const [planVersion, setPlanVersion] = useState(0)
  const [report, setReport] = useState<SiteReport | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)

  // The planners, for the name of the one in charge (Bearbeiter).
  const [planners, setPlanners] = useState<Planner[]>([])
  useEffect(() => {
    api.planners().then(setPlanners, () => {})
  }, [])

  useEffect(() => {
    api.sites().then(setSites, (e) => setError(messageOf(e)))
  }, [])

  useEffect(() => {
    // Over the whole time of the site: its days and costs do not stop at the end of a year.
    api.siteReport(siteId).then(setReport, (e) => setError(messageOf(e)))
  }, [siteId])

  const site = sites.find((candidate) => candidate.id === siteId)
  const current = report && report.siteId === siteId ? report : null

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

  // Deleting asks once; a site with entries in the plan asks again, since they go with it.
  const remove = async () => {
    if (!site || !window.confirm(`Baustelle „${site.name}“ löschen?`)) return
    try {
      try {
        await api.deleteSite(site.id)
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 409) throw e
        if (!window.confirm(`${e.message} Diese Einträge werden mit gelöscht. Wirklich löschen?`)) return
        await api.deleteSite(site.id, true)
      }
      notifications.show({ message: 'Baustelle gelöscht.' })
      window.location.hash = '#/baustellen'
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <div className="page">
      {/* A narrow head that stays at the top while the plan below is scrolled. */}
      <div className="site-page-head">
        <Anchor size="sm" className="site-page-head-back" onClick={() => window.history.back()}>
          ‹ Zurück
        </Anchor>
        <Title order={3} className="site-page-head-name" title={site?.name}>
          {site?.name ?? report?.siteName ?? 'Baustelle'}
        </Title>
        {site && (
          <>
            <SiteStatusPanel
              site={site}
              canEdit
              onChanged={(saved) => setSites((list) => list.map((candidate) => (candidate.id === saved.id ? saved : candidate)))}
            />
            <Group gap={4} wrap="nowrap" className="site-page-head-actions">
              <Button size="compact-sm" variant="light" onClick={() => setEditing(true)}>
                Bearbeiten
              </Button>
              {/* The standard flow also later, e.g. when the Baubeginn was entered without the question. */}
              {site.plannedStart && (
                <Button size="compact-sm" color="wegoRed" onClick={() => setFlowSite(site)}>
                  Standardablauf
                </Button>
              )}
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
                  <Menu.Item color="red" onClick={remove}>
                    Baustelle löschen …
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </>
        )}
      </div>

      {site && (
        <SiteSummary
          site={site}
          withStatus={false}
          planner={planners.find((planner) => planner.id === site.responsiblePlannerId)?.name ?? null}
        />
      )}

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
            if (saved.plannedStart && !site.plannedStart) setFlowSite(saved)
          }}
        />
      )}

      {site && (
        <SiteMiniPlan key={planVersion} site={site} canEdit />
      )}

      {flowSite && (
        <StandardFlowDialog
          site={flowSite}
          onClose={() => setFlowSite(null)}
          onEntered={(step) => {
            // Taken back with the undo arrow of the plan.
            handOverUndo(step)
            setPlanVersion((version) => version + 1)
          }}
        />
      )}

      {current && (
        <>
          <SiteCosting report={current} canCost={canSeeEmployees} />

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
