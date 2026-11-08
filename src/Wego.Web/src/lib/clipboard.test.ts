import { describe, expect, it } from 'vitest'
import type { Entry } from '../api/types'
import { pasteChanges, type Clip } from './clipboard'

const vacation: Entry = {
  id: 1, employeeId: 3, employeeName: 'Koko', date: '2026-11-09', type: 'Urlaub', siteId: null, siteName: null,
  activity: null, startTime: null, endTime: null, note: null, noteImportant: false,
}
const clip: Clip = { label: 'Urlaub', entries: [vacation], cut: false }
const isWorkday = (iso: string) => ![0, 6].includes(new Date(`${iso}T12:00:00`).getDay())

describe('pasteChanges', () => {
  it('leaves out weekends when vacation is pasted over two weeks', () => {
    // Monday 16.11. to Sunday 29.11.2026: two weeks, ten working days.
    const targets = Array.from({ length: 14 }, (_, i) => ({ employeeId: 3, date: `2026-11-${16 + i}` }))
    const changes = pasteChanges(clip, targets, () => [], [], new Map(), isWorkday)
    expect(changes.map((change) => change.date)).toEqual([
      '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20',
      '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27',
    ])
  })

  it('pastes vacation into a single Saturday when that is the one field chosen', () => {
    const changes = pasteChanges(clip, [{ employeeId: 3, date: '2026-11-21' }], () => [], [], new Map(), isWorkday)
    expect(changes).toEqual([expect.objectContaining({ date: '2026-11-21', entries: [expect.objectContaining({ type: 'Urlaub' })] })])
  })

  it('pastes the entries of several days from the first target day on, keeping their distance', () => {
    const site = (id: number, date: string, siteId: number): Entry => ({ ...vacation, id, date, type: 'Baustelle', siteId, siteName: 'S' + siteId, activity: 'Fliesen' })
    // Monday and Tuesday at site 7, Wednesday at site 8; pasted from Monday 23.11. on for two employees.
    const days: Clip = { label: '', cut: false, entries: [site(1, '2026-11-09', 7), site(2, '2026-11-10', 7), site(3, '2026-11-11', 8)] }
    const targets = [{ employeeId: 4, date: '2026-11-23' }, { employeeId: 5, date: '2026-11-23' }]
    const changes = pasteChanges(days, targets, () => [], [], new Map(), isWorkday)
    expect(changes.map((change) => `${change.employeeId} ${change.date} ${change.entries[0].siteId}`)).toEqual([
      '4 2026-11-23 7', '4 2026-11-24 7', '4 2026-11-25 8',
      '5 2026-11-23 7', '5 2026-11-24 7', '5 2026-11-25 8',
    ])
  })
})
