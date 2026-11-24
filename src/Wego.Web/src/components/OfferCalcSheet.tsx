import { Alert, Button, Group, Stack, Table, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { OfferRate, SiteDocument } from '../api/types'
import { euros, priceCalculation, type ProtocolData } from '../lib/offerCalc'
import { formatDate } from '../lib/dates'
import { formatNumber } from '../lib/visitProtocol'
import { Sheet } from './Sheet'

/**
 * For the planners: the calculation of a visit priced with the rates of the offers (net), to write the offer from.
 * As a PDF to save as well. The rates are set under Verwaltung (Planer G).
 */
export function OfferCalcSheet({ document, onClose }: { document: SiteDocument; onClose: () => void }) {
  const [data, setData] = useState<ProtocolData | null>(null)
  const [rates, setRates] = useState<OfferRate[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([api.documentData(document.id), api.offerRates()]).then(
      ([found, foundRates]) => {
        setData(found as ProtocolData)
        setRates(foundRates)
      },
      (e) => setError(messageOf(e)),
    )
  }, [document.id])

  const priced = data && rates ? priceCalculation(data.calc ?? {}, rates) : null

  const savePdf = async () => {
    if (!data || !priced) return
    setBusy(true)
    try {
      const { buildPricedCalcPdf } = await import('../lib/visitProtocolPdf')
      const blob = await buildPricedCalcPdf(data, priced)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = `Kalkulation ${data.siteName} ${data.date}.pdf`.replace(/[\\/:*?"<>|]+/g, '-')
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Kalkulation mit Stundensätzen" onClose={onClose} size="xl">
      <Stack gap="sm">
        {data && (
          <Text size="sm" c="dimmed">
            {data.client} · {data.address} · Besichtigung am {formatDate(data.date)} durch {data.visitor} · netto, nur für die Planer
          </Text>
        )}
        {!priced && !error && <Text size="sm" c="dimmed">Wird geladen …</Text>}
        {priced && priced.groups.length === 0 && <Text size="sm" c="dimmed">In der Kalkulation sind keine Stunden eingetragen.</Text>}
        {priced?.groups.map((group) => (
          <Table.ScrollContainer key={group.title} minWidth={560}>
            <Table withTableBorder className="brand-table offer-calc">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{group.title}</Table.Th>
                  <Table.Th ta="right">Std.</Table.Th>
                  <Table.Th ta="right">Satz</Table.Th>
                  <Table.Th ta="right">Lohn</Table.Th>
                  <Table.Th>Material</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {group.lines.map((line) => (
                  <Table.Tr key={line.id}>
                    <Table.Td>{line.label}</Table.Td>
                    <Table.Td ta="right">{line.hours ? formatNumber(line.hours) : ''}</Table.Td>
                    <Table.Td ta="right" c={line.rate === null && line.hours ? 'red' : undefined}>
                      {line.rate === null ? (line.hours ? 'kein Satz' : '') : euros(line.rate)}
                    </Table.Td>
                    <Table.Td ta="right">{line.hours ? euros(line.amount) : ''}</Table.Td>
                    <Table.Td>{line.material}</Table.Td>
                  </Table.Tr>
                ))}
                <Table.Tr className="offer-calc-sum">
                  <Table.Td>Summe</Table.Td>
                  <Table.Td ta="right">{formatNumber(group.hours)}</Table.Td>
                  <Table.Td />
                  <Table.Td ta="right">{euros(group.labour)}</Table.Td>
                  <Table.Td>{group.material ? euros(group.material) : ''}</Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ))}
        {priced && priced.groups.length > 0 && (
          <div className="offer-calc-total">
            <span>{formatNumber(priced.hours)} Std.</span>
            <span>Lohn {euros(priced.labour)}</span>
            <span>Material {euros(priced.material)}</span>
            <strong>Zusammen netto {euros(priced.net)}</strong>
          </div>
        )}
        {priced && priced.missing.length > 0 && (
          <Alert color="red" variant="light">
            Ohne Stundensatz (nicht in der Summe): {priced.missing.join(', ')}. Die Sätze trägt Planer G unter Verwaltung → Stundensätze ein.
          </Alert>
        )}
        {error && <Alert color="red" variant="light">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Schließen</Button>
          {priced && priced.groups.length > 0 && <Button loading={busy} onClick={() => void savePdf()}>Als PDF speichern</Button>}
        </Group>
      </Stack>
    </Sheet>
  )
}
