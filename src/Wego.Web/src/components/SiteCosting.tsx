import { Alert, Anchor, NumberInput, SimpleGrid, Table, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Employee, SiteHourlyRate, SiteReport } from '../api/types'
import { formatHours } from '../lib/dates'
import { euro, FULL_DAY_HOURS, rowsOf, type HoursRow as Row } from '../lib/siteHours'
import { Stat } from './Stat'

/**
 * The working days on a site over its whole time, in total and per employee; for Planer G the costing
 * afterwards: a wage per hour for each employee and the labour costs of the site.
 */
export function SiteCosting({ report, canCost }: { report: SiteReport; canCost: boolean }) {
  const rows = rowsOf(report.entries)
  const days = rows.reduce((sum, row) => sum + row.days, 0)
  const hours = rows.reduce((sum, row) => sum + row.hours, 0)

  const siteId = report.siteId
  const [employees, setEmployees] = useState<Employee[] | null>(null)
  const [siteRates, setSiteRates] = useState<SiteHourlyRate[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!canCost) return
    Promise.all([api.employees(), api.siteHourlyRates(siteId)]).then(([list, rates]) => {
      setEmployees(list)
      setSiteRates(rates)
    }, (e) => setError(messageOf(e)))
  }, [canCost, siteId])

  // The usual rate comes from Verwaltung – Mitarbeiter; a rate changed here applies to this site only.
  const usualRate = (id: number) => employees?.find((employee) => employee.id === id)?.hourlyRate ?? null
  const siteRate = (id: number) => siteRates.find((rate) => rate.employeeId === id)?.hourlyRate ?? null
  const rateOf = (id: number) => siteRate(id) ?? usualRate(id)
  const saveRate = async (row: Row, value: number | null) => {
    if (value === rateOf(row.id)) return
    // Back to the usual rate: the site keeps no rate of its own.
    const own = value === null || value === usualRate(row.id) ? null : value
    try {
      setSiteRates(await api.setSiteHourlyRate(siteId, row.id, own))
      notifications.show({
        message: own === null ? `${row.name}: wieder der übliche Stundensatz.` : `Stundensatz von ${row.name} für diese Baustelle gespeichert.`,
        autoClose: 2000,
      })
    } catch (e) {
      setError(messageOf(e))
    }
  }
  const costs = rows.reduce((sum, row) => sum + row.hours * (rateOf(row.id) ?? 0), 0)
  const missing = rows.filter((row) => rateOf(row.id) === null)

  return (
    <>
      <Title order={4} mb="xs" className="section-heading">
        Arbeitstage
      </Title>
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm" mb="xs">
        <Stat value={days} label="Arbeitstage gesamt" />
        <Stat value={rows.length} label="Handwerker" tone="red" />
        <Stat value={formatHours(hours)} label="Stunden" tone="filled" />
      </SimpleGrid>
      <Text size="sm" c="dimmed" mb="sm">
        Über die ganze Zeit der Baustelle. Ein Tag ohne Zeitfenster zählt {FULL_DAY_HOURS} Stunden (07:30–16:00 mit
        30 Minuten Pause), ein halber Tag die Stunden seines Zeitfensters.
      </Text>
      <Table.ScrollContainer minWidth={380} mb="lg">
        <Table striped withTableBorder className="brand-table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Handwerker</Table.Th>
              <Table.Th ta="right">Arbeitstage</Table.Th>
              <Table.Th ta="right">Stunden</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.id}>
                <Table.Td>{row.name}</Table.Td>
                <Table.Td ta="right">{row.days}</Table.Td>
                <Table.Td ta="right">{formatHours(row.hours)}</Table.Td>
              </Table.Tr>
            ))}
            {rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={3}>Noch keine Einsätze auf dieser Baustelle.</Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr>
              <Table.Th>Summe</Table.Th>
              <Table.Th ta="right">{days}</Table.Th>
              <Table.Th ta="right">{formatHours(hours)}</Table.Th>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Table.ScrollContainer>

      {canCost && (
        <section className="costing" aria-label="Nachkalkulation">
          <Title order={4} mb="xs" className="section-heading">
            Nachkalkulation
          </Title>
          {error && (
            <Alert color="red" variant="light" mb="sm">
              {error}
            </Alert>
          )}
          <Table.ScrollContainer minWidth={520}>
            <Table withTableBorder className="brand-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Handwerker</Table.Th>
                  <Table.Th ta="right">Arbeitstage</Table.Th>
                  <Table.Th ta="right">Stunden</Table.Th>
                  <Table.Th ta="right">Stundensatz</Table.Th>
                  <Table.Th ta="right">Lohnkosten</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => {
                  const rate = rateOf(row.id)
                  const usual = usualRate(row.id)
                  const differs = siteRate(row.id) !== null
                  return (
                    <Table.Tr key={row.id}>
                      <Table.Td>{row.name}</Table.Td>
                      <Table.Td ta="right">{row.days}</Table.Td>
                      <Table.Td ta="right">{formatHours(row.hours)}</Table.Td>
                      <Table.Td ta="right">
                        {employees && (
                          <NumberInput
                            key={`${row.id}-${rate}`}
                            aria-label={`Stundensatz ${row.name}`}
                            size="xs"
                            w={130}
                            ml="auto"
                            min={0}
                            max={1000}
                            decimalScale={2}
                            decimalSeparator=","
                            thousandSeparator="."
                            suffix=" €/Std."
                            hideControls
                            placeholder="€/Std."
                            defaultValue={rate ?? ''}
                            onBlur={(event) => {
                              const text = event.currentTarget.value.replace(/[^0-9,]/g, '').replace(',', '.')
                              saveRate(row, text === '' ? null : Number(text)).catch(() => {})
                            }}
                          />
                        )}
                        {differs && (
                          <Text size="xs" c="orange.8" mt={2}>
                            nur hier · üblich {usual === null ? 'keiner' : `${euro(usual)}/Std.`}{' '}
                            <Anchor component="button" type="button" size="xs" onClick={() => saveRate(row, null)}>
                              zurücksetzen
                            </Anchor>
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right">{rate === null ? '–' : euro(row.hours * rate)}</Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
              <Table.Tfoot>
                <Table.Tr>
                  <Table.Th>Lohnkosten gesamt</Table.Th>
                  <Table.Th ta="right">{days}</Table.Th>
                  <Table.Th ta="right">{formatHours(hours)}</Table.Th>
                  <Table.Th />
                  <Table.Th ta="right">{euro(costs)}</Table.Th>
                </Table.Tr>
              </Table.Tfoot>
            </Table>
          </Table.ScrollContainer>
          {employees && missing.length > 0 && (
            <Text size="sm" c="orange.8" mt={6}>
              Ohne Stundensatz, noch nicht in den Lohnkosten: {missing.map((row) => row.name).join(', ')}
            </Text>
          )}
          <Text size="xs" c="dimmed" mt={6}>
            Der übliche Stundensatz kommt aus Verwaltung – Mitarbeiter. Hier geändert gilt er nur für diese Baustelle.
            Nur für Planer G sichtbar.
          </Text>
        </section>
      )}
    </>
  )
}
