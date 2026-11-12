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

  it('marks a site waiting when nothing happened for two weeks and nothing is planned', () => {
    const steps = offerSteps(site, [entry('Besichtigung', '2026-10-05')], '2026-11-10')
    expect(waitingDays(steps, '2026-11-10')).toBe(36)
    expect(waitingDays(offerSteps(site, [entry('Besichtigung', '2026-11-05')], '2026-11-10'), '2026-11-10')).toBeNull()
  })
})
