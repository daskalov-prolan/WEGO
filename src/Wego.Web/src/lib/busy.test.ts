import { describe, expect, it } from 'vitest'
import type { Entry, MeetingWeek } from '../api/types'
import { meetingClashes } from './busy'

const week = { meetingId: 1, title: 'Bauberatung', date: '2026-12-16', originalDate: '2026-12-16', startTime: '09:00:00', endTime: '10:30:00',
  employeeIds: [6], moved: false, requested: [], names: {} } as MeetingWeek
const entry = (part: Partial<Entry>) => ({ id: 1, employeeId: 6, date: '2026-12-16', type: 'Baustelle', siteId: 5, siteName: 'Liesebach',
  activity: 'Sanitaer', startTime: '07:30:00', endTime: '11:30:00', note: null, noteImportant: false, ...part }) as Entry

describe('meetingClashes', () => {
  it('names the sites at the time of the meeting, not those before or after, nor vacation or time kept free', () => {
    expect(meetingClashes(week, [entry({})])).toEqual(['Liesebach'])
    expect(meetingClashes(week, [entry({ startTime: '10:30:00', endTime: '16:00:00' })])).toEqual([])
    expect(meetingClashes(week, [entry({ type: 'Urlaub', siteId: null, siteName: null, activity: null, startTime: null, endTime: null })])).toEqual([])
    expect(meetingClashes(week, [entry({ siteId: null, siteName: null, activity: null })])).toEqual([])
  })
})
