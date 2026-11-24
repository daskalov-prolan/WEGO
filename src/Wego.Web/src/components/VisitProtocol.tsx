import { Alert, Button, Chip, Group, Modal, SimpleGrid, Stack, Tabs, Text, Textarea, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useRef, useState } from 'react'
import type { Entry, Site } from '../api/types'
import { formatDateLong } from '../lib/dates'
import { clientName, formatAddress } from '../lib/sites'
import { enqueue, loadDraft, saveDraft, toBase64 } from '../lib/tabletStore'
import {
  CALCULATION,
  calcHours,
  CHECKLIST,
  CONFIRMATION,
  documentFileName,
  formatNumber,
  isAsked,
  protocolKey,
  type CalcValue,
  type Protocol,
  type Question,
  type Sheet,
} from '../lib/visitProtocol'
import { DrawPad } from './DrawPad'

interface Props {
  site: Site
  /** The visit in the plan: its day and time. */
  entry: Entry
  /** Who makes the visit (the signed-in employee). */
  visitor: string
  onClose: () => void
}

const DRAWING = { width: 1500, height: 1000 }
const SIGNATURE = { width: 900, height: 300 }
const PENS = [
  { label: 'Stift', color: '#14232a' },
  { label: 'Rot', color: '#d71f27' },
  { label: 'Petrol', color: '#0f6378' },
]

const newSheet = (name: string, kind: Sheet['kind'] = 'drawing', image: string | null = null): Sheet => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  name,
  kind,
  image,
})

/** A new protocol of this visit: what the plan knows of the customer is filled in already. */
function freshProtocol(site: Site, entry: Entry, visitor: string): Protocol {
  return {
    key: protocolKey(site.id, entry.date),
    siteId: site.id,
    siteName: site.name,
    client: clientName(site) ?? site.name,
    address: formatAddress(site) ?? '',
    // The first number is the mobile, the second the landline (see the form of a site).
    phone: site.clientPhone2 ?? '',
    mobile: site.clientPhone ?? '',
    date: entry.date,
    time: entry.startTime?.slice(0, 5) ?? '',
    visitor,
    answers: {},
    calc: {},
    sheets: [newSheet('Ist-Zustand'), newSheet('Soll-Zustand')],
    signature: null,
    signer: '',
    finishedAt: null,
  }
}

/** A photo of the tablet, smaller (at most 1600 pixels wide or high), as JPEG. */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * The visit on the tablet, in four steps: the check list, the calculation by trade, drawings and photos, and the
 * confirmation the customer signs on the display. Kept on the tablet with every change (also without internet);
 * finished, it becomes two PDFs (the protocol, and the confirmation alone for the invoice) that go to the site as
 * soon as the tablet is online.
 */
export function VisitProtocol({ site, entry, visitor, onClose }: Props) {
  const [protocol, setProtocol] = useState<Protocol | null>(null)
  const [step, setStep] = useState<string | null>('liste')
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [pen, setPen] = useState(PENS[0].color)
  const [erase, setErase] = useState(false)
  // A new key wipes a pad: it opens again empty.
  const [padKey, setPadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const photoInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void loadDraft(protocolKey(site.id, entry.date)).then((draft) => {
      if (cancelled) return
      const found = draft ?? freshProtocol(site, entry, visitor)
      setProtocol(found)
      setSheetId(found.sheets[0]?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [site, entry, visitor])

  // Every change is kept on the tablet at once: the visit goes on after the app was closed.
  useEffect(() => {
    if (protocol) void saveDraft(protocol)
  }, [protocol])

  if (!protocol) return null
  const done = protocol.finishedAt !== null
  const change = (next: Partial<Protocol>) => setProtocol((current) => (current ? { ...current, ...next } : current))
  const answer = (id: string, value: string) => change({ answers: { ...protocol.answers, [id]: value } })
  const calc = (id: string, value: Partial<CalcValue>) =>
    change({ calc: { ...protocol.calc, [id]: { ...protocol.calc[id], ...value } } })
  const sheet = protocol.sheets.find((s) => s.id === sheetId) ?? protocol.sheets[0]
  const setSheet = (id: string, value: Partial<Sheet>) =>
    change({ sheets: protocol.sheets.map((s) => (s.id === id ? { ...s, ...value } : s)) })

  const question = (q: Question) => {
    if (!isAsked(q, protocol.answers)) return null
    const value = protocol.answers[q.id] ?? ''
    return (
      <div key={q.id} className="protocol-question">
        <Text size="sm" fw={q.bold ? 700 : 500} className="protocol-label">{q.label}</Text>
        <div>
          {q.kind === 'choice' && (
            // Tapped again, a choice is taken back.
            <Chip.Group multiple={false} value={value} onChange={(next) => answer(q.id, next === value ? '' : next)}>
              <Group gap={6}>
                {q.options!.map((option) => (
                  <Chip key={option} value={option} size="md" variant="filled" disabled={done}
                    onClick={() => { if (option === value) answer(q.id, '') }}>
                    {option}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          )}
          {(q.kind === 'text' || q.kind === 'number') && (
            <Group gap={6} wrap="nowrap">
              <TextInput aria-label={q.label} value={value} disabled={done} inputMode={q.kind === 'number' ? 'decimal' : undefined}
                onChange={(event) => answer(q.id, event.currentTarget.value)} style={{ flex: q.kind === 'number' ? '0 0 110px' : 1 }} />
              {q.unit && <Text size="sm">{q.unit}</Text>}
            </Group>
          )}
          {q.kind === 'note' && (
            <Textarea aria-label={q.label} value={value} disabled={done} autosize minRows={3}
              onChange={(event) => answer(q.id, event.currentTarget.value)} />
          )}
          {q.hint && <Text size="xs" className="protocol-hint">{q.hint}</Text>}
        </div>
      </div>
    )
  }

  const addPhoto = async (file: File | undefined) => {
    if (!file) return
    const photos = protocol.sheets.filter((s) => s.kind === 'photo').length
    const added = newSheet(`Foto ${photos + 1}`, 'photo', await shrinkPhoto(file))
    change({ sheets: [...protocol.sheets, added] })
    setSheetId(added.id)
  }

  const finish = async () => {
    setError('')
    if (!protocol.signature) return setError('Bitte den Kunden unterschreiben lassen.')
    if (!protocol.signer.trim()) return setError('Bitte den Namen des Kunden in Druckschrift eintragen.')
    setBusy(true)
    try {
      const finished: Protocol = { ...protocol, finishedAt: new Date().toISOString() }
      // Only loaded when a visit is finished: the plan does not carry it.
      const { buildConfirmationPdf, buildProtocolPdf } = await import('../lib/visitProtocolPdf')
      const [whole, confirmation] = await Promise.all([buildProtocolPdf(finished), buildConfirmationPdf(finished)])
      const base = { siteId: finished.siteId, siteName: finished.siteName, createdAt: finished.finishedAt! }
      await saveDraft(finished)
      setProtocol(finished)
      await enqueue([
        { ...base, key: `${finished.key}|protokoll|${finished.finishedAt}`, kind: 'Besichtigungsprotokoll',
          fileName: documentFileName('Besichtigungsprotokoll', finished), base64: await toBase64(whole) },
        { ...base, key: `${finished.key}|bestaetigung|${finished.finishedAt}`, kind: CONFIRMATION.title,
          fileName: documentFileName(CONFIRMATION.title, finished), base64: await toBase64(confirmation) },
      ])
      notifications.show({
        color: 'green',
        message: navigator.onLine
          ? 'Besichtigung abgeschlossen. Die beiden PDFs werden zur Baustelle gesendet.'
          : 'Besichtigung abgeschlossen. Die PDFs werden gesendet, sobald das Tablet Internet hat.',
      })
    } catch (e) {
      setError(`Die PDFs konnten nicht erstellt werden: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const total = calcHours(protocol.calc)

  return (
    // The steps stay at the top with the customer while the page scrolls: the tabs live in the title of the window.
    <Tabs value={step} onChange={setStep} keepMounted={false} variant="pills" radius="xl" className="protocol-tabs">
    <Modal opened onClose={onClose} fullScreen trapFocus={false} className="visit-protocol" title={
      <Stack gap={6}>
        <div>
          <Text fw={800}>Besichtigung · {protocol.client}</Text>
          <Text size="sm" c="dimmed">{protocol.address} · {formatDateLong(protocol.date)}{protocol.time ? `, ${protocol.time} Uhr` : ''}</Text>
        </div>
        <Tabs.List grow>
          <Tabs.Tab value="liste">1 Check-Liste</Tabs.Tab>
          <Tabs.Tab value="kalkulation">2 Kalkulation</Tabs.Tab>
          <Tabs.Tab value="zeichnungen">3 Zeichnungen</Tabs.Tab>
          <Tabs.Tab value="unterschrift">4 Unterschrift</Tabs.Tab>
        </Tabs.List>
      </Stack>
    }>
      {done && (
        <Alert color="green" variant="light" mb="sm" title="Abgeschlossen">
          Die Besichtigung ist abgeschlossen und unterschrieben. Die PDFs gehen zur Baustelle, sobald das Tablet Internet hat
          (ein Hinweis in Mein Plan zeigt, ob noch etwas wartet).
        </Alert>
      )}

        <Tabs.Panel value="liste" pt="md">
          <div className="protocol-section">
            <Text fw={700} className="protocol-title">Kunde</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <TextInput label="Kunde" value={protocol.client} disabled={done} onChange={(e) => change({ client: e.currentTarget.value })} />
              <TextInput label="Adresse BV" value={protocol.address} disabled={done} onChange={(e) => change({ address: e.currentTarget.value })} />
              <TextInput label="Telefon privat" value={protocol.phone} disabled={done} onChange={(e) => change({ phone: e.currentTarget.value })} />
              <TextInput label="Mobil" value={protocol.mobile} disabled={done} onChange={(e) => change({ mobile: e.currentTarget.value })} />
            </SimpleGrid>
          </div>
          <div className="protocol-columns">
            {CHECKLIST.map((section) => (
              <div key={section.title} className="protocol-section">
                <Text fw={700} className="protocol-title">{section.title}</Text>
                {section.hint && <Text size="xs" className="protocol-hint">{section.hint}</Text>}
                {section.questions.map(question)}
              </div>
            ))}
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="kalkulation" pt="md">
          <div className="protocol-columns">
            {CALCULATION.map((group) => (
              <div key={group.title} className="protocol-section">
                <Group justify="space-between">
                  <Text fw={700} className="protocol-title">{group.title}</Text>
                  <Text fw={700} size="sm" className="protocol-sum">{formatNumber(calcHours(protocol.calc, group))} Std.</Text>
                </Group>
                {group.items.map((item) => {
                  const value = protocol.calc[item.id] ?? {}
                  return (
                    <div key={item.id} className="protocol-question">
                      <Text size="sm" className="protocol-label">{item.label}</Text>
                      <Group gap={6}>
                        {item.options && (
                          <Chip.Group multiple={false} value={value.choice ?? ''} onChange={(next) => calc(item.id, { choice: next === value.choice ? '' : next })}>
                            <Group gap={6}>
                              {item.options.map((option) => (
                                <Chip key={option} value={option} size="md" variant="filled" disabled={done}
                                  onClick={() => { if (option === value.choice) calc(item.id, { choice: '' }) }}>
                                  {option}
                                </Chip>
                              ))}
                            </Group>
                          </Chip.Group>
                        )}
                        {item.qm && (
                          <TextInput aria-label={`${item.label} qm`} rightSection="qm" w={110} inputMode="decimal" value={value.qm ?? ''}
                            disabled={done} onChange={(e) => calc(item.id, { qm: e.currentTarget.value })} />
                        )}
                        {item.hours && (
                          <TextInput aria-label={`${item.label} Stunden`} rightSection="Std." rightSectionWidth={42} w={110} inputMode="decimal"
                            value={value.hours ?? ''} disabled={done} onChange={(e) => calc(item.id, { hours: e.currentTarget.value })} />
                        )}
                        {item.material && (
                          <TextInput aria-label={`${item.label} Material`} placeholder="Material" w={150} value={value.material ?? ''}
                            disabled={done} onChange={(e) => calc(item.id, { material: e.currentTarget.value })} />
                        )}
                      </Group>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="protocol-total">
            <span>Zusammen</span>
            <span>{formatNumber(total)} Std. · ca. {formatNumber(total / 8)} Arbeitstage</span>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="zeichnungen" pt="md">
          <Group gap={6} mb="xs" className="protocol-tools">
            {protocol.sheets.map((s) => (
              <Chip key={s.id} checked={s.id === sheet?.id} onChange={() => setSheetId(s.id)} size="md" variant="filled">
                {s.kind === 'photo' ? '📷 ' : ''}{s.name}
              </Chip>
            ))}
            {!done && (
              <>
                <Button variant="light" radius="xl" onClick={() => {
                  const added = newSheet(`Zeichnung ${protocol.sheets.filter((s) => s.kind === 'drawing').length + 1}`)
                  change({ sheets: [...protocol.sheets, added] })
                  setSheetId(added.id)
                }}>+ Blatt</Button>
                <Button variant="light" radius="xl" onClick={() => photoInput.current?.click()}>📷 Foto</Button>
                <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden
                  onChange={(event) => { void addPhoto(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
              </>
            )}
          </Group>
          {sheet?.kind === 'drawing' && !done && (
            <Group gap={6} mb="xs">
              {PENS.map((p) => (
                <Chip key={p.color} checked={!erase && pen === p.color} onChange={() => { setPen(p.color); setErase(false) }} size="md" variant="filled">
                  {p.label}
                </Chip>
              ))}
              <Chip checked={erase} onChange={() => setErase(true)} size="md" variant="filled">Radierer</Chip>
              <Button variant="subtle" color="gray" onClick={() => { setSheet(sheet.id, { image: null }); setPadKey((k) => k + 1) }}>Blatt leeren</Button>
            </Group>
          )}
          {sheet?.kind === 'drawing' && (
            done ? (
              sheet.image ? <img src={sheet.image} alt={sheet.name} className="draw-pad grid" /> : <Text c="dimmed">Leer.</Text>
            ) : (
              <DrawPad key={`${sheet.id}-${padKey}`} value={sheet.image} onChange={(image) => setSheet(sheet.id, { image })}
                {...DRAWING} color={pen} erase={erase} grid steps label={sheet.name} />
            )
          )}
          {sheet?.kind === 'photo' && sheet.image && (
            <Stack gap="xs" align="flex-start">
              <img src={sheet.image} alt={sheet.name} className="protocol-photo" />
              {!done && (
                <Button variant="subtle" color="red" onClick={() => {
                  change({ sheets: protocol.sheets.filter((s) => s.id !== sheet.id) })
                  setSheetId(protocol.sheets[0]?.id ?? null)
                }}>Foto entfernen</Button>
              )}
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="unterschrift" pt="md">
          <div className="protocol-letter">
            <Text fw={800} size="lg">{CONFIRMATION.title}</Text>
            <Text size="sm" c="dimmed" mb="sm">{protocol.client} · {protocol.address} · {formatDateLong(protocol.date)}</Text>
            <div className="protocol-position">
              <span>{CONFIRMATION.text}</span>
              <strong>{CONFIRMATION.price}</strong>
            </div>
            <Text size="sm" mt="md" fw={600}>{CONFIRMATION.confirm}</Text>
            <Text size="sm" mt={6} mb={6}>{CONFIRMATION.credit}</Text>
            {done ? (
              protocol.signature && <img src={protocol.signature} alt="Unterschrift" className="sign-pad" />
            ) : (
              <DrawPad key={`sign-${padKey}`} value={protocol.signature} onChange={(signature) => change({ signature })}
                {...SIGNATURE} color="#0b2a6b" lineWidth={4} label="Unterschrift des Kunden" />
            )}
            <Group justify="space-between" mt={4}>
              <Text size="xs" c="dimmed">Unterschrift Kunde (mit dem Finger oder Stift)</Text>
              {!done && (
                <Button size="compact-sm" variant="subtle" color="gray" onClick={() => { change({ signature: null }); setPadKey((k) => k + 1) }}>
                  Unterschrift löschen
                </Button>
              )}
            </Group>
            <TextInput mt="sm" label="Name des Kunden in Druckschrift" value={protocol.signer} disabled={done}
              onChange={(e) => change({ signer: e.currentTarget.value })} />
          </div>
          {error && <Alert color="red" variant="light" mt="sm">{error}</Alert>}
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>{done ? 'Schließen' : 'Später weitermachen'}</Button>
            {!done && <Button loading={busy} onClick={() => void finish()}>Besichtigung abschließen</Button>}
          </Group>
        </Tabs.Panel>
    </Modal>
    </Tabs>
  )
}
