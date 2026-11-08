import { useCallback, useEffect, useState } from 'react'
import { api, UNAUTHORIZED_EVENT } from './api/client'
import { setActivities } from './lib/activities'
import { canPlanRole } from './lib/roles'
import type { User } from './api/types'
import { AppShell } from './components/AppShell'
import { AdminPage } from './pages/AdminPage'
import { EmployeesPage } from './pages/EmployeesPage'
import { EmployeeReportPage } from './pages/EmployeeReportPage'
import { LoginPage, NewPasswordPage } from './pages/LoginPage'
import { MyAreaPage } from './pages/MyAreaPage'
import { MyPlanPage } from './pages/MyPlanPage'
import { PlanPage } from './pages/PlanPage'
import { SitePage } from './pages/SitePage'
import { SitesPage } from './pages/SitesPage'
import { CURRENT_YEAR } from './lib/dates'
import { useIsPhone } from './lib/useIsPhone'
import { goHome } from './lib/home'

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
  // Kept in memory only, so that somebody with an initial password does not have to type it twice.
  const [loginPassword, setLoginPassword] = useState('')
  const [page, param] = useHashRoute()
  const phone = useIsPhone()
  // The activities are kept under Verwaltung: loaded once signed in, and again when they change there.
  const [activities, setActivitiesVersion] = useState(0)
  const signedIn = Boolean(user && !user.mustChangePassword)

  useEffect(() => {
    api.me().then(
      (signedIn) => {
        // On a phone the app always opens with the own plan, whatever page was open before.
        if (signedIn.showInPlan && window.matchMedia?.('(max-width: 720px)').matches) window.location.hash = '#/mein-plan'
        setUser(signedIn)
      },
      () => setUser(null),
    )
    const onUnauthorized = () => setUser(null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const reloadActivities = useCallback(
    () =>
      api.activities().then((defs) => {
        setActivities(defs)
        setActivitiesVersion((version) => version + 1)
      }),
    [],
  )
  useEffect(() => {
    // Without them the plan still works with the activities it starts with.
    if (signedIn) reloadActivities().catch(() => setActivitiesVersion((version) => version + 1))
  }, [signedIn, reloadActivities])

  if (user === undefined) return null
  if (user === null) {
    return (
      <LoginPage
        onLogin={(signedIn, password) => {
          setLoginPassword(password)
          // On a phone the day begins with the own plan, whatever page was open before.
          if (phone && signedIn.showInPlan) window.location.hash = '#/mein-plan'
          setUser(signedIn)
        }}
      />
    )
  }
  if (user.mustChangePassword) {
    return (
      <NewPasswordPage
        user={user}
        knownPassword={loginPassword}
        onDone={() => {
          setLoginPassword('')
          setUser({ ...user, mustChangePassword: false })
        }}
        onLogout={() => api.logout().finally(() => setUser(null))}
      />
    )
  }

  if (activities === 0) return null

  const canPlan = canPlanRole(user.role)
  const isAdmin = user.role === 'PlanerG'
  const selectedId = param ? Number(param) : null

  // Craftsmen start with their own week, planners with the plan of everybody (in the construction phase).
  // On a phone everybody in the plan starts with his own plan.
  const startPage = user.showInPlan && (!canPlan || phone) ? 'mein-plan' : 'bauphase'
  // The plan has a page per phase; "plan" (older links) is the construction phase, and so is the offer
  // phase for whoever may not see it.
  const offers = user.seesOffers !== false
  const current = page === 'plan' || (page === 'angebotsphase' && !offers) ? 'bauphase' : page || startPage
  const phase = current === 'angebotsphase' ? 'Angebot' : 'Bauphase'

  let content
  if (current === 'mein-plan' && user.showInPlan) content = <MyPlanPage year={year} user={user} onYearChange={setYear} />
  else if (page === 'mein-bereich') content = <MyAreaPage user={user} />
  // Sites are for planners; employees with their reports and the administration for Planer G only.
  else if (page === 'baustellen' && canPlan)
    content = selectedId ? <SitePage key={selectedId} year={year} siteId={selectedId} canSeeEmployees={isAdmin} /> : <SitesPage canFinish={isAdmin} />
  else if (page === 'mitarbeiter')
    content =
      selectedId && isAdmin ? (
        <EmployeeReportPage key={selectedId} year={year} onYearChange={setYear} employeeId={selectedId} />
      ) : (
        <EmployeesPage canEdit={isAdmin} />
      )
  else if (page === 'verwaltung' && isAdmin)
    content = <AdminPage key={selectedId ?? 0} year={year} employeeId={selectedId} onActivitiesChanged={reloadActivities} />
  else
    content = (
      <PlanPage
        key={`${year}|${activities}`}
        year={year}
        phase={phase}
        canEdit={canPlan}
        canAbsence={isAdmin}
        user={user}
        onYearChange={setYear}
      />
    )

  return (
    <AppShell
      user={user}
      page={current}
      onLogout={() => api.logout().finally(() => setUser(null))}
      homePage={user.showInPlan ? 'mein-plan' : startPage}
      onHome={() => {
        setYear(CURRENT_YEAR)
        goHome()
      }}
    >
      {content}
    </AppShell>
  )
}
