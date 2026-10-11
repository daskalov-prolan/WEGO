import { useEffect, useState } from 'react'
import { api, UNAUTHORIZED_EVENT } from './api/client'
import type { User } from './api/types'
import { AppShell } from './components/AppShell'
import { AdminPage } from './pages/AdminPage'
import { CustomerReportPage } from './pages/CustomerReportPage'
import { EmployeeReportPage } from './pages/EmployeeReportPage'
import { LoginPage } from './pages/LoginPage'
import { PlanPage } from './pages/PlanPage'
import { CURRENT_YEAR } from './lib/dates'

function useHashRoute(): string[] {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash.replace(/^#\/?/, '').split('/')
}

export default function App() {
  // undefined: not known yet, null: signed out
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [year, setYear] = useState(CURRENT_YEAR)
  const [page, param] = useHashRoute()

  useEffect(() => {
    api.me().then(setUser, () => setUser(null))
    const onUnauthorized = () => setUser(null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  if (user === undefined) return null
  if (user === null) return <LoginPage onLogin={setUser} />

  const isPlaner = user.role === 'Planer'
  const selectedId = param ? Number(param) : null

  let content
  if (page === 'baustellen') content = <CustomerReportPage year={year} customerId={selectedId} />
  else if (page === 'mitarbeiter') content = <EmployeeReportPage year={year} user={user} employeeId={selectedId} />
  else if (page === 'verwaltung' && isPlaner) content = <AdminPage year={year} />
  else content = <PlanPage year={year} canEdit={isPlaner} />

  return (
    <AppShell
      user={user}
      page={page || 'plan'}
      year={year}
      onYearChange={setYear}
      onLogout={() => api.logout().finally(() => setUser(null))}
    >
      {content}
    </AppShell>
  )
}
