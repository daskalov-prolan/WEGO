import { afterEach, describe, expect, it, vi } from 'vitest'
import { CALCULATION, CHECKLIST, calcHours, isAsked } from './visitProtocol'
import { enqueue, flushOutbox, outbox } from './tabletStore'

describe('visit protocol', () => {
  it('asks a question only after the answer it depends on (e.g. how many core drillings after "ja")', () => {
    const anzahl = CHECKLIST.flatMap((s) => s.questions).find((q) => q.id === 'kernbohrungAnzahl')!
    expect(isAsked(anzahl, {})).toBe(false)
    expect(isAsked(anzahl, { kernbohrung: 'nein' })).toBe(false)
    expect(isAsked(anzahl, { kernbohrung: 'ja' })).toBe(true)
  })

  it('asks for the lift and the distance of the container', () => {
    const ids = CHECKLIST.flatMap((s) => s.questions).map((q) => q.id)
    expect(ids).toContain('aufzug')
    expect(ids).toContain('container')
  })

  it('adds up the hours by trade and in all, with commas as on paper', () => {
    const demontage = CALCULATION.find((g) => g.title === 'Demontage')!
    const calc = { demSanitaer: { hours: '3' }, demWandfliesen: { hours: '2,5' }, frischwasser: { hours: '6', material: '180 €' } }
    expect(calcHours(calc, demontage)).toBe(5.5)
    expect(calcHours(calc)).toBe(11.5)
  })
})

describe('outbox on the tablet', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the PDFs while there is no internet and sends them once it is back, each once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    await enqueue([{ key: 'k1', siteId: 7, siteName: 'Muster', kind: 'Besichtigungsprotokoll', fileName: 'a.pdf', base64: 'JVBERg==', createdAt: '' }])
    expect(await flushOutbox()).toBe(1)
    expect((await outbox()).map((item) => item.key)).toEqual(['k1'])

    const online = vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 201 }))
    vi.stubGlobal('fetch', online)
    expect(await flushOutbox()).toBe(0)
    expect(online).toHaveBeenCalledWith('/api/sites/7/documents', expect.objectContaining({ method: 'POST' }))
    const init = (online.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(String(init.body)).clientKey).toBe('k1')
  })
})
