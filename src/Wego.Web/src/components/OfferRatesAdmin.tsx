import { Alert, Button, Group, NumberInput, Paper, Stack, Table, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import { CALCULATION } from '../lib/visitProtocol'

/**
 * Verwaltung (Planer G): the rate per hour, net, of each position of the calculation of a visit. The planners
 * price the calculation of a visit with them on the page of its site; the visitor never sees them.
 */
export function OfferRatesAdmin() {
  const [rates, setRates] = useState<Record<string, number | ''> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.offerRates().then(
      (found) => setRates(Object.fromEntries(found.map((r) => [r.key, r.hourlyRate]))),
      (e) => setError(messageOf(e)),
    )
  }, [])

  const save = async () => {
    if (!rates) return
    setBusy(true)
    setError('')
    try {
      const list = Object.entries(rates)
        .filter(([, rate]) => rate !== '')
        .map(([key, rate]) => ({ key, hourlyRate: Number(rate) }))
      const saved = await api.saveOfferRates(list)
      setRates(Object.fromEntries(saved.map((r) => [r.key, r.hourlyRate])))
      notifications.show({ color: 'green', message: 'Die Stundensätze sind gespeichert.' })
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        Stundensatz netto je Position der Kalkulation einer Besichtigung. Die Planer sehen damit auf der Seite der Baustelle
        die Kalkulation mit Preisen (unter Dokumente). Der Besichtiger und die Handwerker sehen die Sätze nicht.
      </Text>
      {!rates && !error && <Text size="sm" c="dimmed">Wird geladen …</Text>}
      {rates && CALCULATION.map((group) => {
        const items = group.items.filter((item) => item.hours)
        if (items.length === 0) return null
        return (
          <Paper key={group.title} withBorder p="sm" className="offer-rates-group">
            <Title order={5} mb="xs" className="section-heading">{group.title}</Title>
            <Table verticalSpacing={4}>
              <Table.Tbody>
                {items.map((item) => (
                  <Table.Tr key={item.id}>
                    <Table.Td>{item.label}</Table.Td>
                    <Table.Td w={170}>
                      <NumberInput aria-label={`Stundensatz ${item.label}`} value={rates[item.id] ?? ''} min={0} max={1000}
                        decimalScale={2} decimalSeparator="," thousandSeparator="." suffix=" €/Std." hideControls placeholder="–"
                        onChange={(value) => setRates((current) => ({ ...current, [item.id]: value === '' ? '' : Number(value) }))} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        )
      })}
      {error && <Alert color="red" variant="light">{error}</Alert>}
      {rates && (
        <Group justify="flex-end">
          <Button loading={busy} onClick={() => void save()}>Stundensätze speichern</Button>
        </Group>
      )}
    </Stack>
  )
}
