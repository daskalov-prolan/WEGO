import type { CSSProperties } from 'react'
import { activityInfo } from '../lib/activities'
import { formatDate } from '../lib/dates'
import type { OfferStep } from '../lib/offerSteps'

const STATE: Record<OfferStep['state'], string> = { done: 'erledigt', planned: 'geplant', open: 'offen' }

/**
 * How far a site is in the offer phase: one dot per step in its fixed order, filled in the colour of the step when
 * done, a ring when planned, grey when open; beside them how long it has been waiting, if it is.
 */
export function OfferSteps({ steps, waiting }: { steps: OfferStep[]; waiting: number | null }) {
  const text = steps.map((step) => `${step.label}: ${STATE[step.state]}${step.date ? ` ${formatDate(step.date)}` : ''}`)
  return (
    <span className="offer-steps" title={[...text, waiting !== null ? `wartet seit ${waiting} Tagen` : null].filter(Boolean).join('\n')}>
      {steps.map((step) => (
        <span
          key={step.activity}
          className={`offer-step ${step.state}`}
          style={{ '--step-color': activityInfo(step.activity)?.background ?? '#8fa3a8' } as CSSProperties}
          aria-label={`${step.label} ${STATE[step.state]}`}
        />
      ))}
      {waiting !== null && <span className="offer-waiting">wartet {waiting} T.</span>}
    </span>
  )
}
