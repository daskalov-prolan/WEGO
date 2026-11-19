import { Alert, Button, Group, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useState } from 'react'
import { api, messageOf } from '../api/client'
import type { DoneReport, Site } from '../api/types'
import { writeSummary } from '../lib/siteDone'
import { askPdfTarget, pdfFileName } from '../lib/sitePdf'
import { Sheet } from './Sheet'

/** "2026-11-19T14:05:00Z" -> "19.11.2026 um 15:05" (local time). */
const doneAt = (iso: string) => {
  const at = new Date(iso)
  const day = at.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return `${day} um ${time}`
}

/**
 * For Planer G: the sites a Planer A set to done since he last looked, who and when. Each with its summary as a
 * PDF (with the wages: made here, in his browser) or only marked seen. Either way it leaves the list.
 */
export function DoneReportsSheet({ reports, onClose, onChanged }: {
  reports: DoneReport[]
  onClose: () => void
  /** Something was marked seen: the list is loaded again. */
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')

  const seen = async (report: DoneReport) => {
    setBusy(report.siteId)
    setError('')
    try {
      await api.doneReportSeen(report.siteId)
      onChanged()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(null)
    }
  }

  const savePdf = async (report: DoneReport) => {
    // Asked right after the click: the dialog for the file needs it.
    const target = await askPdfTarget(pdfFileName({ name: report.siteName } as Site))
    if (!target) return
    setBusy(report.siteId)
    setError('')
    try {
      await writeSummary(await api.site(report.siteId), target)
      await api.doneReportSeen(report.siteId)
      notifications.show({ message: `Die Zusammenfassung von „${report.siteName}“ ist gespeichert.`, color: 'green' })
      onChanged()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet title="Erledigte Baustellen" onClose={onClose} size="lg">
      <Stack gap="xs">
        {reports.map((report) => (
          <div key={report.siteId} className="clash-row done-row">
            <Text size="sm" fw={700}>{report.siteName}</Text>
            <Text size="sm" c="dimmed">
              Auf erledigt gesetzt{report.changedBy ? ` von ${report.changedBy}` : ''} am {doneAt(report.changedAt)}
            </Text>
            <Group gap="xs" mt={4}>
              <Button size="compact-sm" loading={busy === report.siteId} onClick={() => void savePdf(report)}>
                📄 Report als PDF speichern
              </Button>
              <Button size="compact-sm" variant="default" disabled={busy === report.siteId} onClick={() => void seen(report)}>
                Gesehen
              </Button>
            </Group>
          </div>
        ))}
        {reports.length === 0 && <Text size="sm" c="dimmed">Keine neuen erledigten Baustellen.</Text>}
        {error && <Alert color="red" variant="light">{error}</Alert>}
      </Stack>
    </Sheet>
  )
}
