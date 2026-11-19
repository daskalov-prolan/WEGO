import { describe, expect, it } from 'vitest'
import type { Entry, Site } from '../api/types'
import { offerSteps, waitingDays } from './offerSteps'

const site = { id: 5, name: 'Winter', status: 'Angebot', requestedOn: '2026-10-01' } as Site
const entry = (activity: string, date: string) => ({ siteId: 5, activity, date }) as Entry

describe('offerSteps', () => {
  it('follows a site through the offer phase in its fixed order', () => {
    const steps = offerSteps(site, [entry('Besichtigung', '2026-10-05'), entry('Objektauswahl', '2026-11-20')], '2026-11-10')
    expect(steps.map((step) => [step.activity, step.state, step.date])).toEqual([
      ['Anfrage', 'done', '2026-10-01'],
      ['Besichtigung', 'done', '2026-10-05'],
      ['Objektauswahl', 'planned', '2026-11-20'],
      ['Angebotsuebergabe', 'open', null],
    ])
    // Something planned: not waiting.
    expect(waitingDays(steps, '2026-11-10')).toBeNull()
  })

  it('counts a step done only once its day is over', () => {
    const on = (today: string) => offerSteps(site, [entry('Objektauswahl', '2026-11-19')], today).find((s) => s.activity === 'Objektauswahl')?.state
    expect(on('2026-11-19')).toBe('planned')
    expect(on('2026-11-20')).toBe('done')
  })

  it('marks a site waiting when nothing happened for a week and nothing is planned', () => {
    const steps = offerSteps(site, [entry('Besichtigung', '2026-10-05')], '2026-11-10')
    expect(waitingDays(steps, '2026-11-10')).toBe(36)
    expect(waitingDays(offerSteps(site, [entry('Besichtigung', '2026-11-05')], '2026-11-10'), '2026-11-10')).toBeNull()
    // Only the enquiry, the visit open: marked after 7 days.
    const asked = (day: string) => offerSteps({ ...site, requestedOn: day }, [], '2026-11-10')
    expect(waitingDays(asked('2026-11-04'), '2026-11-10')).toBeNull()
    expect(waitingDays(asked('2026-11-03'), '2026-11-10')).toBe(7)
  })

  it('lets the Objektauswahl and the Angebotsübergabe wait 10 days before it is marked', () => {
    const visited = (day: string) => offerSteps(site, [entry('Besichtigung', day)], '2026-11-20')
    expect(waitingDays(visited('2026-11-11'), '2026-11-20')).toBeNull()
    expect(waitingDays(visited('2026-11-10'), '2026-11-20')).toBe(10)
  })
})
