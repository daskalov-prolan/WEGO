import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { api, UNAUTHORIZED_EVENT } from './api/client'
import { setActivities } from './lib/activities'
import { canPlanRole } from './lib/roles'
import type { User } from './api/types'
import { AppShell } from './components/AppShell'
import { LoginPage, NewPasswordPage } from './pages/LoginPage'
import { MyPlanPage } from './pages/MyPlanPage'
import { PlanPage } from './pages/PlanPage'
import { CURRENT_YEAR } from './lib/dates'
import { useIsPhone } from './lib/useIsPhone'
import { goHome } from './lib/home'

// The plans open at once; the other pages are loaded when they are opened, so a phone starts with less.
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })))
const EmployeesPage = lazy(() => import('./pages/EmployeesPage').then((module) => ({ default: module.EmployeesPage })))
const EmployeeReportPage = lazy(() => import('./pages/EmployeeReportPage').then((module) => ({ default: module.EmployeeReportPage })))
const MyAreaPage = lazy(() => import('./pages/MyAreaPage').then((module) => ({ default: module.MyAreaPage })))
const SitePage = lazy(() => import('./pages/SitePage').then((module) => ({ default: module.SitePage })))
const SitesPage = lazy(() => import('./pages/SitesPage').then((module) => ({ default: module.SitesPage })))
const OfferPhasePage = lazy(() => import('./pages/OfferPhasePage').then((module) => ({ default: module.OfferPhasePage })))

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
  const selectedId = param && /^\d+$/.test(param) ? Number(param) : null

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
        <EmployeesPage canEdit={isAdmin} showBirthdays={canPlan} />
      )
  else if (page === 'verwaltung' && isAdmin)
    content = (
      <AdminPage key={param ?? 0} year={year} employeeId={selectedId} tab={param} onActivitiesChanged={reloadActivities} />
    )
  else {
    const plan = (
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
    // The offer phase for planners: the overview of the enquiries, or the calendar.
    content = phase === 'Angebot' && canPlan ? <OfferPhasePage calendar={plan} /> : plan
  }

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
      <Suspense fallback={null}>{content}</Suspense>
    </AppShell>
  )
}
