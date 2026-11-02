// Copies employees and construction sites from the live system into a local WEGO for development.
//
//   node tools/sync-from-live/sync.mjs                    dry run: prints what would change locally
//   node tools/sync-from-live/sync.mjs --apply            writes to the local application
//   ... --only=employees | --only=sites
//
// Environment:
//   WEGO_LIVE_USER, WEGO_LIVE_PASSWORD   your own Planer account on the live system (required)
//   WEGO_LIVE_URL                        default https://planer.wego-badcenter.de
//   WEGO_URL                             local API, default http://localhost:5284; only localhost is accepted
//   WEGO_USER, WEGO_PASSWORD             local Planer account, default planer / wego-dev-2026
//
// The live system is only read. Locally every change goes through the normal API, nothing is deleted:
// records that exist only locally stay and are listed at the end. Employees are matched by name, sites by
// name and address (or by name alone when that is unique). Logins are not copied: new employees come without
// user name, existing ones keep their local login and role. Plan entries, vacation and sick days stay live only.

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length)
if (only && !['employees', 'sites'].includes(only)) throw new Error('--only takes employees or sites')

const PHASE_ACTIVITIES = {
  Angebot: ['Besichtigung', 'Objektauswahl', 'Angebotsuebergabe'],
  Bauphase: ['Abriss', 'Trockenbau', 'Sanitaer', 'RenoDeco', 'Fliesen', 'Endmontage'],
}
// Activities renamed since: a live system on an older version still sends the old keys.
const RENAMED = { Angebotskalkulation: 'Objektauswahl', Angebotsbesprechung: 'Angebotsuebergabe' }
const renamed = (activity) => RENAMED[activity] ?? activity
const PLANNER_ROLES = ['Planer', 'PlanerA', 'PlanerG']
const EMPLOYEE_FIELDS = ['name', 'sortOrder', 'isActive', 'showInPlan', 'vacationDaysPerYear', 'mainActivity', 'additionalActivities']
const SITE_FIELDS = ['client', 'clientPhone', 'street', 'houseNumber', 'addressAddition', 'postalCode', 'city', 'nameSource',
  'description', 'plannedStart', 'plannedEnd', 'labelProjectNumber']

const norm = (value) => (value ?? '').toString().trim().toLocaleLowerCase('de')
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const pick = (record, fields) => Object.fromEntries(fields.map((f) => [f, record[f] ?? null]))

/** A small API client with the login cookie. The live client refuses everything but reading. */
function apiClient(base, { readOnly }) {
  let cookie = ''
  return async function call(method, path, body) {
    if (readOnly && method !== 'GET' && path !== '/api/auth/login')
      throw new Error(`${method} ${path} is not allowed on the live system`)
    const response = await fetch(new URL(path, base), {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const authCookie = response.headers.getSetCookie().find((c) => c.startsWith('wego.auth='))
    if (authCookie) cookie = authCookie.split(';')[0]
    if (!response.ok) throw new Error(`${method} ${base}${path}: ${response.status} ${await response.text()}`)
    return response.status === 204 ? null : response.json()
  }
}

async function signIn(call, userName, password, label) {
  try {
    const user = await call('POST', '/api/auth/login', { userName, password })
    if (!PLANNER_ROLES.includes(user.role)) throw new Error(`${userName} is not a Planer`)
  } catch (error) {
    throw new Error(`Sign-in at ${label} failed (${error.message}). Check user name and password.`)
  }
}

// ---- Employees ----

async function syncEmployees(live, local) {
  const liveEmployees = (await live('GET', '/api/employees')).map((e) => ({
    ...e,
    mainActivity: e.mainActivity && renamed(e.mainActivity),
    additionalActivities: e.additionalActivities.map(renamed),
  }))
  const localEmployees = await local('GET', '/api/employees')
  const unused = new Set(localEmployees)
  const actions = []

  for (const source of liveEmployees) {
    const target = [...unused].find((e) => norm(e.name) === norm(source.name))
    if (target) {
      unused.delete(target)
      const changed = EMPLOYEE_FIELDS.filter((f) => !same(source[f], target[f]))
      if (changed.length === 0) continue
      actions.push({
        text: `Mitarbeiter ${source.name}: ${changed.join(', ')}`,
        run: () => local('PUT', `/api/employees/${target.id}`, {
          ...pick(source, EMPLOYEE_FIELDS), userName: target.userName, role: target.role, password: null,
        }),
      })
    } else {
      actions.push({
        text: `Mitarbeiter ${source.name}: neu`,
        run: () => local('POST', '/api/employees', {
          ...pick(source, EMPLOYEE_FIELDS), userName: null, role: 'Handwerker', password: null,
        }),
      })
    }
  }
  return { actions, localOnly: [...unused].map((e) => e.name) }
}

// ---- Construction sites ----

/** The status changes that lead from a local status to the live one, or null when there is no way. */
function statusPath(from, source) {
  const order = ['Angebot', 'Bauphase', 'Abgeschlossen']
  const forward = (a, b) => {
    const i = order.indexOf(a), j = order.indexOf(b)
    return i >= 0 && j >= i ? order.slice(i + 1, j + 1) : null
  }
  if (from === source.status) return []
  if (from === 'Storniert') return null
  if (source.status === 'Storniert') {
    // Pass through the phase the live site reached first, so that its activities exist locally too.
    const reached = source.tasks.some((t) => PHASE_ACTIVITIES.Bauphase.includes(t.activity)) ? 'Bauphase' : 'Angebot'
    return [...(forward(from, reached) ?? []), 'Storniert']
  }
  return forward(from, source.status)
}

const siteKey = (s) => [s.name, s.street, s.houseNumber, s.postalCode, s.city].map(norm).join('|')

async function syncSites(live, local) {
  const liveSites = (await live('GET', '/api/sites')).map((s) => ({
    ...s,
    tasks: s.tasks.map((t) => ({ ...t, activity: renamed(t.activity) })),
  }))
  const localSites = await local('GET', '/api/sites')
  const unused = new Set(localSites)
  const actions = []
  const notes = []

  for (const source of liveSites) {
    let target = [...unused].find((s) => siteKey(s) === siteKey(source))
    if (!target) {
      const byName = [...unused].filter((s) => norm(s.name) === norm(source.name))
      if (byName.length === 1) target = byName[0]
    }
    if (target) unused.delete(target)

    const start = target ? null
      : source.status === 'Angebot' || source.tasks.some((t) => PHASE_ACTIVITIES.Angebot.includes(t.activity))
        ? 'Angebot' : 'Bauphase'
    const fromStatus = target?.status ?? start
    const path = statusPath(fromStatus, source)
    if (path === null) notes.push(`Baustelle ${source.name}: Status lokal ${fromStatus}, live ${source.status}; lässt sich nicht angleichen`)

    // Activities the local site will have after the status changes, and those whose values differ.
    const localTasks = new Map((target?.tasks ?? []).map((t) => [t.activity, t]))
    const generated = new Set([start, ...(path ?? [])].flatMap((s) => PHASE_ACTIVITIES[s] ?? []))
    const taskUpdates = []
    for (const task of source.tasks) {
      const current = localTasks.get(task.activity)
        ?? (generated.has(task.activity) ? { estimatedDays: 1, notNeeded: false } : null)
      if (!current) notes.push(`Baustelle ${source.name}: Tätigkeit ${task.activity} fehlt lokal`)
      else if (current.estimatedDays !== task.estimatedDays || current.notNeeded !== task.notNeeded) taskUpdates.push(task)
    }

    const changedFields = target ? SITE_FIELDS.filter((f) => !same(source[f], target[f])) : []
    const parts = [
      ...(target ? [] : ['neu']),
      ...(changedFields.length ? [changedFields.join(', ')] : []),
      ...(path?.length ? [`Status ${fromStatus} -> ${path.join(' -> ')}`] : []),
      ...(taskUpdates.length ? [`Tätigkeiten ${taskUpdates.map((t) => t.activity).join(', ')}`] : []),
    ]
    if (parts.length === 0) continue

    actions.push({
      text: `Baustelle ${source.name}: ${parts.join('; ')}`,
      run: async () => {
        let id = target?.id
        if (!target) id = (await local('POST', '/api/sites', { ...pick(source, SITE_FIELDS), status: start })).id
        else if (changedFields.length) await local('PUT', `/api/sites/${id}`, pick(source, SITE_FIELDS))
        for (const status of path ?? []) await local('POST', `/api/sites/${id}/status`, { status })
        for (const task of taskUpdates) {
          await local('PUT', `/api/sites/${id}/tasks/${task.activity}`,
            { estimatedDays: task.estimatedDays, notNeeded: task.notNeeded })
        }
      },
    })
  }
  return { actions, notes, localOnly: [...unused].map((s) => s.name) }
}

// ---- Main ----

const liveUrl = process.env.WEGO_LIVE_URL ?? 'https://planer.wego-badcenter.de'
const localUrl = new URL(process.env.WEGO_URL ?? 'http://localhost:5284')
if (!['localhost', '127.0.0.1', '[::1]'].includes(localUrl.hostname))
  throw new Error(`WEGO_URL must point to a local API, not ${localUrl.origin}`)
const { WEGO_LIVE_USER, WEGO_LIVE_PASSWORD } = process.env
if (!WEGO_LIVE_USER || !WEGO_LIVE_PASSWORD)
  throw new Error('Set WEGO_LIVE_USER and WEGO_LIVE_PASSWORD (your Planer account on the live system).')

const live = apiClient(liveUrl, { readOnly: true })
const local = apiClient(localUrl.origin, { readOnly: false })
await signIn(live, WEGO_LIVE_USER, WEGO_LIVE_PASSWORD, liveUrl)
await signIn(local, process.env.WEGO_USER ?? 'planer', process.env.WEGO_PASSWORD ?? 'wego-dev-2026', localUrl.origin)

const results = []
if (only !== 'sites') results.push(['Mitarbeiter', await syncEmployees(live, local)])
if (only !== 'employees') results.push(['Baustellen', await syncSites(live, local)])

for (const [label, { actions, notes = [], localOnly }] of results) {
  console.log(`\n${label}: ${actions.length} Änderung(en)${apply ? '' : ' (Probelauf)'}`)
  for (const action of actions) {
    console.log(`  ${action.text}`)
    if (apply) await action.run()
  }
  for (const note of notes) console.log(`  Hinweis: ${note}`)
  if (localOnly.length) console.log(`  Nur lokal, bleibt unverändert: ${localOnly.join(', ')}`)
}
if (!apply) console.log('\nNichts geschrieben. Mit --apply übernehmen.')
