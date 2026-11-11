import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import './styles/app.css'
import 'dayjs/locale/de'

import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { Notifications } from '@mantine/notifications'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { theme } from './theme'

// Zoomed in with two fingers: marked on the page, so that the plan does not snap into place meanwhile. Where the
// part in view lies and how big it is drawn go along: a window (a note, a day) opens over just that part at its
// usual size, rather than zoomed as well and reaching beyond the screen (see html.zoomed in app.css).
const viewport = window.visualViewport
if (viewport) {
  const root = document.documentElement
  const mark = () => {
    const zoomed = viewport.scale > 1.01
    root.classList.toggle('zoomed', zoomed)
    if (zoomed) {
      root.style.setProperty('--view-left', `${viewport.offsetLeft}px`)
      root.style.setProperty('--view-top', `${viewport.offsetTop}px`)
      root.style.setProperty('--view-shrink', String(1 / viewport.scale))
    }
  }
  viewport.addEventListener('resize', mark)
  viewport.addEventListener('scroll', mark)
  mark()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <DatesProvider settings={{ locale: 'de', firstDayOfWeek: 1, consistentWeeks: true }}>
        <Notifications position="bottom-center" />
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
)
