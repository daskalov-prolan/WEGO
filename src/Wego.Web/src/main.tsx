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

// Zoomed in with two fingers: marked on the page, so that the plan does not snap into place meanwhile.
const viewport = window.visualViewport
if (viewport) {
  const mark = () => document.documentElement.classList.toggle('zoomed', viewport.scale > 1.01)
  viewport.addEventListener('resize', mark)
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
