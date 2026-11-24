import { api } from '../api/client'
import type { Protocol } from './visitProtocol'

/**
 * What the tablet keeps for itself, in the browser (IndexedDB): the protocols of visits while they are made, and
 * the PDFs to send. Without internet at the customer everything stays here; once the tablet is online the PDFs go
 * to their site by themselves. Without IndexedDB (e.g. in tests) it is kept in memory only.
 */

/** A PDF waiting to be sent to its site. */
export interface OutboxItem {
  /** Also the key of the document on the server: sent twice, it is kept once. */
  key: string
  siteId: number
  siteName: string
  kind: string
  fileName: string
  base64: string
  createdAt: string
  /** What was filled in (JSON), kept with the protocol for the planners to price its calculation. */
  data?: string
}

const DB = 'wego-tablet'
const DRAFTS = 'drafts'
const OUTBOX = 'outbox'
/** Told when the outbox changes: the count of what waits shows in Mein Plan. */
export const OUTBOX_EVENT = 'wego:outbox'

const memory = { [DRAFTS]: new Map<string, unknown>(), [OUTBOX]: new Map<string, unknown>() }
let opening: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore(DRAFTS, { keyPath: 'key' })
        request.result.createObjectStore(OUTBOX, { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

async function run<T>(store: typeof DRAFTS | typeof OUTBOX, mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  if (!db) throw new Error('no db')
  return new Promise<T>((resolve, reject) => {
    const request = act(db.transaction(store, mode).objectStore(store))
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error)
  })
}

async function put(store: typeof DRAFTS | typeof OUTBOX, value: { key: string }) {
  try {
    await run(store, 'readwrite', (s) => s.put(value))
  } catch {
    memory[store].set(value.key, value)
  }
}

async function get<T>(store: typeof DRAFTS | typeof OUTBOX, key: string): Promise<T | undefined> {
  try {
    return await run<T | undefined>(store, 'readonly', (s) => s.get(key))
  } catch {
    return memory[store].get(key) as T | undefined
  }
}

async function all<T>(store: typeof DRAFTS | typeof OUTBOX): Promise<T[]> {
  try {
    return await run<T[]>(store, 'readonly', (s) => s.getAll())
  } catch {
    return [...memory[store].values()] as T[]
  }
}

async function remove(store: typeof DRAFTS | typeof OUTBOX, key: string) {
  try {
    await run(store, 'readwrite', (s) => s.delete(key))
  } catch {
    memory[store].delete(key)
  }
}

export const loadDraft = (key: string) => get<Protocol>(DRAFTS, key)
export const saveDraft = (protocol: Protocol) => put(DRAFTS, protocol)
export const allDrafts = () => all<Protocol>(DRAFTS)

export const outbox = () => all<OutboxItem>(OUTBOX)

/** Puts PDFs into the outbox and tries to send them at once. */
export async function enqueue(items: OutboxItem[]) {
  for (const item of items) await put(OUTBOX, item)
  window.dispatchEvent(new Event(OUTBOX_EVENT))
  void flushOutbox()
}

let flushing: Promise<number> | null = null

/** Sends what waits, one by one; what fails (no internet, signed out) waits for the next time. Returns how many are left. */
export function flushOutbox(): Promise<number> {
  flushing ??= (async () => {
    try {
      for (const item of await outbox()) {
        try {
          await api.uploadDocument(item.siteId, { kind: item.kind, fileName: item.fileName, contentBase64: item.base64, clientKey: item.key, data: item.data })
          await remove(OUTBOX, item.key)
          window.dispatchEvent(new Event(OUTBOX_EVENT))
        } catch {
          // Offline or signed out: it stays and goes the next time.
          break
        }
      }
      return (await outbox()).length
    } finally {
      flushing = null
    }
  })()
  return flushing
}

/** Sends what waits now, whenever the tablet comes online, and every minute while the app is open. */
export function startOutbox() {
  void flushOutbox()
  window.addEventListener('online', () => void flushOutbox())
  window.setInterval(() => {
    if (navigator.onLine) void flushOutbox()
  }, 60_000)
}

/** A blob as base64, without the "data:...;base64," in front. */
export function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
