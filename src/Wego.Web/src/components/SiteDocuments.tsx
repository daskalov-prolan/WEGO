import { Button, Group, Text, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SiteDocument } from '../api/types'

/** "2026-11-26T10:52:00Z" -> "26.11.2026, 11:52" (local time). */
const at = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** 1234567 -> "1,2 MB" */
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`)

/**
 * The documents of a site (e.g. the protocol of the visit and the confirmation signed by the customer): each to
 * open in the browser or to save elsewhere. Nothing shows while there are none, or without internet.
 */
export function SiteDocuments({ siteId }: { siteId: number }) {
  const [documents, setDocuments] = useState<SiteDocument[]>([])
  useEffect(() => {
    let cancelled = false
    api.siteDocuments(siteId).then(
      (found) => { if (!cancelled) setDocuments(Array.isArray(found) ? found : []) },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [siteId])

  if (documents.length === 0) return null
  return (
    <div className="site-documents">
      <Title order={4} mb="xs" className="section-heading">Dokumente</Title>
      {documents.map((document) => (
        <Group key={document.id} justify="space-between" wrap="wrap" gap="xs" className="site-document">
          <div>
            <Text fw={600} size="sm">{document.kind.startsWith('Bestätigung') ? '✍️' : '📄'} {document.kind}</Text>
            <Text size="xs" c="dimmed">
              {document.createdBy ? `von ${document.createdBy} · ` : ''}{at(document.createdAt)} · {size(document.size)}
            </Text>
          </div>
          <Group gap="xs">
            <Button component="a" size="compact-sm" href={`/api/sites/documents/${document.id}`} target="_blank" rel="noreferrer">
              Öffnen
            </Button>
            <Button component="a" size="compact-sm" variant="light" href={`/api/sites/documents/${document.id}?download=true`} download={document.fileName}>
              Speichern
            </Button>
          </Group>
        </Group>
      ))}
    </div>
  )
}
