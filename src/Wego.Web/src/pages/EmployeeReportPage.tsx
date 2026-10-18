import { Alert, Anchor, Badge, Paper, SimpleGrid, Table, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Employee, EmployeeReport, Vacation } from '../api/types'
import { ActivitiesEditor, ActivityBadges } from '../components/EmployeeActivities'
import { EmployeeMiniPlan } from '../components/EmployeeMiniPlan'
import { Stat } from '../components/Stat'
import { formatDate, formatHours, formatTimeRange } from '../lib/dates'
import { toEmployeeInput } from '../lib/employees'

interface Props {
  year: number
  employeeId: number
}

/**
 * Planner-only: the page of one employee. Their activities, their planning, and where they worked during
 * the year, with vacation and sick days.
 */
export function EmployeeReportPage({ year, employeeId }: Props) {
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [report, setReport] = useState<EmployeeReport | null>(null)
  const [overview, setOverview] = useState<Vacation[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // Counts saved changes of the activities: the planning below loads again with them.
  const [skillsVersion, setSkillsVersion] = useState(0)

  useEffect(() => {
    api.employees().then(
      (all) => setEmployee(all.find((candidate) => candidate.id === employeeId) ?? null),
      (e) => setError(messageOf(e)),
    )
  }, [employeeId])

  useEffect(() => {
    api.employeeReport(employeeId, year).then(setReport, (e) => setError(messageOf(e)))
  }, [employeeId, year])

  useEffect(() => {
    api.vacationOverview(year).then(setOverview, (e) => setError(messageOf(e)))
  }, [year])

  const current = report && report.employeeId === employeeId && report.year === year ? report : null

  /** Saves the activities right away; the planning then offers what fits them. */
  const saveSkills = async (skills: Pick<Employee, 'mainActivity' | 'additionalActivities'>) => {
    if (!employee) return
    setSaving(true)
    try {
      const saved = await api.updateEmployee(employee.id, { ...toEmployeeInput(employee), ...skills })
      setEmployee(saved)
      setSkillsVersion((version) => version + 1)
      notifications.show({ message: 'Tätigkeiten gespeichert.', color: 'green' })
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="site-page-head">
        <Anchor size="sm" className="site-page-head-back" onClick={() => window.history.back()}>
          ‹ Zurück
        </Anchor>
        <Title order={3} className="site-page-head-name">
          {employee?.name ?? current?.employeeName ?? 'Mitarbeiter'}
        </Title>
        {employee && (
          <span className="site-page-head-facts">
            <ActivityBadges mainActivity={employee.mainActivity} additionalActivities={employee.additionalActivities} />
            {!employee.isActive && <Badge color="gray">inaktiv</Badge>}
            {!employee.showInPlan && (
              <Badge color="gray" variant="outline">
                nicht im Plan
              </Badge>
            )}
          </span>
        )}
        <Anchor href="#/mitarbeiter" size="sm" className="site-page-head-actions">
          Alle Mitarbeiter
        </Anchor>
      </div>

      {error && (
        <Alert color="red" variant="light" mb="md">
          {error}
        </Alert>
      )}

      {employee && (
        <Paper withBorder p="md" mb="lg">
          <ActivitiesEditor
            employeeId={employee.id}
            year={year}
            value={employee}
            disabled={saving}
            wide
            onChange={(skills) => saveSkills(skills)}
          />
          <Text size="xs" c="dimmed" mt="xs">
            Name, Zugang und Urlaubstage stehen in der Verwaltung.
          </Text>
        </Paper>
      )}

      <EmployeeMiniPlan key={`${employeeId}-${skillsVersion}`} employeeId={employeeId} canEdit />

      <Title order={3} mb="sm">
        Auswertung {year}
      </Title>

      {current && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="sm" mb="lg">
            <Stat value={current.totalDays} label={`Tage auf Baustellen ${current.year}`} />
            <Stat value={current.sites.length} label="Baustellen" />
            <Stat
              value={`${current.vacation.used} / ${current.vacation.entitlement}`}
              label="Urlaubstage verbraucht bzw. eingeplant"
            />
            <Stat
              value={current.vacation.remaining}
              label="Urlaubstage noch verfügbar"
              negative={current.vacation.remaining < 0}
            />
            <Stat value={current.vacation.sickDays} label="Krankheitstage" />
          </SimpleGrid>

          <Title order={4} mb="xs">
            Nach Baustelle
          </Title>
          <Table.ScrollContainer minWidth={420} mb="lg">
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Baustelle</Table.Th>
                  <Table.Th ta="right">Einsatztage</Table.Th>
                  <Table.Th ta="right">Stunden</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {current.sites.map((row) => (
                  <Table.Tr key={row.id}>
                    <Table.Td>
                      <Anchor href={`#/baustellen/${row.id}`}>{row.name}</Anchor>
                    </Table.Td>
                    <Table.Td ta="right">{row.days}</Table.Td>
                    <Table.Td ta="right">{formatHours(row.hours)}</Table.Td>
                  </Table.Tr>
                ))}
                {current.sites.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={3}>Keine Einsätze in {current.year}.</Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          <Title order={4} mb="xs">
            Alle Einsätze
          </Title>
          <Table.ScrollContainer minWidth={420} mb="lg">
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Tag</Table.Th>
                  <Table.Th>Baustelle</Table.Th>
                  <Table.Th>Zeitfenster</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {current.entries.map((entry) => (
                  <Table.Tr key={entry.id}>
                    <Table.Td>{formatDate(entry.date)}</Table.Td>
                    <Table.Td>{entry.siteName}</Table.Td>
                    <Table.Td>{formatTimeRange(entry) || 'ganztägig'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}

      {overview.length > 0 && (
        <>
          <Title order={4} mb="xs">
            Urlaubsübersicht {year}
          </Title>
          <Table.ScrollContainer minWidth={520}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Mitarbeiter</Table.Th>
                  <Table.Th ta="right">Anspruch</Table.Th>
                  <Table.Th ta="right">Verbraucht / eingeplant</Table.Th>
                  <Table.Th ta="right">Verfügbar</Table.Th>
                  <Table.Th ta="right">Krankheitstage</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {overview.map((row) => (
                  <Table.Tr key={row.employeeId}>
                    <Table.Td>
                      <Anchor href={`#/mitarbeiter/${row.employeeId}`}>{row.employeeName}</Anchor>
                    </Table.Td>
                    <Table.Td ta="right">{row.entitlement}</Table.Td>
                    <Table.Td ta="right">{row.used}</Table.Td>
                    <Table.Td ta="right" c={row.remaining < 0 ? 'red.7' : undefined}>
                      {row.remaining}
                    </Table.Td>
                    <Table.Td ta="right">{row.sickDays}</Table.Td>
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
