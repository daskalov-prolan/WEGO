import { SegmentedControl } from '@mantine/core'
import { useState, type ReactNode } from 'react'
import { OfferBoardPage } from './OfferBoardPage'

const VIEW_KEY = 'wego.offer.view'
type View = 'board' | 'calendar'

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'board'
  } catch {
    return 'board'
  }
}

/**
 * The offer phase for planners: the overview of the enquiries (Übersicht), or the calendar as before; the
 * choice is kept for the next visit.
 */
export function OfferPhasePage({ calendar }: { calendar: ReactNode }) {
  const [view, setView] = useState<View>(loadView)
  const change = (next: View) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Without storage the choice holds until the page is left.
    }
  }
  return (
    <div className="offer-phase">
      <div className="offer-phase-switch">
        <SegmentedControl
          size="sm"
          value={view}
          onChange={(value) => change(value as View)}
          data={[
            { value: 'board', label: 'Übersicht' },
            { value: 'calendar', label: 'Kalender' },
          ]}
        />
      </div>
      <div className="offer-phase-content">{view === 'board' ? <OfferBoardPage /> : calendar}</div>
    </div>
  )
}
