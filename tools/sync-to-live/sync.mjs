// Brings data entered in a local WEGO into the live system: activities, employees, construction sites, the plan
// (entries, vacation, sick days) and the notes. Where a record differs, the local one wins.
//
//   node --env-file=tools/sync-from-live/.env tools/sync-to-live/sync.mjs          dry run: lists what would change live
//   node --env-file=tools/sync-from-live/.env tools/sync-to-live/sync.mjs --apply  writes to the live system
//   ... --years=2026,2027,2028  the years of the plan (default: 2026 to two years ahead)
//
// Environment:
//   WEGO_LIVE_USER, WEGO_LIVE_PASSWORD   a Planer G account on the live system (required)
//   WEGO_LIVE_URL                        default https://planer.wego-badcenter.de
//   WEGO_URL                             local API, default http://localhost:5284; only localhost is accepted
//   WEGO_USER, WEGO_PASSWORD             local Planer account, default planer / wego-dev-2026
//
// The local system is only read. Live, every change goes through the normal API (and its change log); nothing
// is deleted there: records and plan days that exist only live stay. A plan day that exists in both is set to
// the local one. Employees are matched by name (a call name before " - " and nicknames in brackets left out),
// sites by name and address. Logins, roles and passwords are never sent: live accounts keep theirs.

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const thisYear = new Date().getFullYear()
const years = (args.find((a) => a.startsWith('--years='))?.slice(8).split(',').map(Number)) ??
  Array.from({ length: thisYear + 2 - 2026 + 1 }, (_, i) => 2026 + i)

const EMPLOYEE_FIELDS = ['name', 'sortOrder', 'isActive', 'showInPlan', 'vacationDaysPerYear', 'mainActivity',
  'additionalActivities', 'phone', 'hourlyRate']
const SITE_FIELDS = ['client', 'clientPhone', 'street', 'houseNumber', 'addressAddition', 'postalCode', 'city', 'nameSource',
  'description', 'plannedStart', 'plannedEnd', 'labelProjectNumber']
const MAX_DAYS_PER_BATCH = 400

const norm = (value) => (value ?? '').toString().trim().toLocaleLowerCase('de')
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const pick = (record, fields) => Object.fromEntries(fields.map((f) => [f, record[f] ?? null]))
/** "Niko - Nikolay Mihov" and "Nikolay Prodanov (Koko)" are Nikolay Mihov and Nikolay Prodanov. */
const coreName = (name) => {
  const plain = (name ?? '').replace(/\(.*?\)/g, ' ')
  return norm(plain.includes(' - ') ? plain.split(' - ').slice(1).join(' - ') : plain).replace(/\s+/g, ' ')
}

/** A small API client with the login cookie; writing live only with --apply. */
function apiClient(base, { readOnly }) {
  let cookie = ''
  return async function call(method, path, body) {
    if (readOnly && method !== 'GET' && path !== '/api/auth/login') throw new Error(`${method} ${path}: ${base} is only read`)
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

async function signIn(call, userName, password, label, role) {
  let user
  try {
    user = await call('POST', '/api/auth/login', { userName, password })
  } catch (error) {
    throw new Error(`Anmeldung bei ${label} fehlgeschlagen (${error.message}).`)
  }
  if (role && user.role !== role) throw new Error(`${userName} bei ${label} ist kein ${role}: Mitarbeiter und Tätigkeiten brauchen Planer G.`)
}

// ---- Activities: label, phase and colour by key; their order ----

async function syncActivities(live, local) {
  const liveList = await live('GET', '/api/activities')
  const localList = await local('GET', '/api/activities')
  const byKey = new Map(liveList.map((a) => [a.key, a]))
  const actions = []
  const notes = []
  for (const source of localList) {
    const target = byKey.get(source.key)
    if (!target) {
      notes.push(`Tätigkeit ${source.label} (${source.key}) gibt es live nicht; bitte live von Hand anlegen`)
      continue
    }
    const changed = ['label', 'phase', 'color'].filter((f) => !same(source[f], target[f]))
    if (changed.length)
      actions.push({
        text: `Tätigkeit ${source.label}: ${changed.map((f) => `${f} ${target[f]} -> ${source[f]}`).join(', ')}`,
        run: () => live('PUT', `/api/activities/${source.key}`, pick(source, ['label', 'phase', 'color'])),
      })
  }
  // The local order; activities that exist only live keep their place behind (the order must name every one).
  const liveOrder = [...liveList].sort((a, b) => a.sortOrder - b.sortOrder).map((a) => a.key)
  const order = [...localList.filter((a) => byKey.has(a.key)).map((a) => a.key), ...liveOrder.filter((k) => !localList.some((a) => a.key === k))]
  const liveOnly = liveList.filter((a) => !localList.some((l) => l.key === a.key))
  if (liveOnly.length) notes.push(`Nur live, bleibt: ${liveOnly.map((a) => a.label).join(', ')}`)
  if (!same(order, liveOrder)) actions.push({ text: 'Reihenfolge der Tätigkeiten', run: () => live('PUT', '/api/activities/order', order) })
  return { actions, notes }
}

// ---- Employees ----

/** The name an employee is called by: before " - " ("Koko - Nikolay Prodanov"), else the whole name. */
const callName = (name) => norm((name ?? '').includes(' - ') ? name.split(' - ')[0] : name)
const lastName = (name) => coreName(name).split(' ').at(-1)

/**
 * The live employee of a local one, the first rule that finds exactly one: the same name; the same name without
 * call name and nickname; the call name as the whole name ("Koko"); the same last name ("Niko Mihov" and
 * "Nikolay Mihov").
 */
function matchEmployee(source, candidates) {
  const rules = [
    (e) => norm(e.name) === norm(source.name),
    (e) => coreName(e.name) === coreName(source.name),
    (e) => norm(e.name) === callName(source.name) || callName(e.name) === norm(source.name),
    (e) => coreName(source.name).includes(' ') && lastName(e.name) === lastName(source.name),
  ]
  for (const rule of rules) {
    const found = candidates.filter(rule)
    if (found.length === 1) return found[0]
  }
  return undefined
}

/** The account of the local development (planer / wego-dev-2026) does not go live. */
const isDevAccount = (employee) => norm(employee.userName) === 'planer'

async function syncEmployees(live, local) {
  const liveList = await live('GET', '/api/employees')
  const localList = (await local('GET', '/api/employees')).filter((e) => !isDevAccount(e))
  const unused = new Set(liveList)
  const actions = []
  for (const source of localList) {
    const target = matchEmployee(source, [...unused])
    if (target) {
      unused.delete(target)
      const changed = EMPLOYEE_FIELDS.filter((f) => !same(source[f], target[f]))
      if (changed.length === 0) continue
      actions.push({
        text: `Mitarbeiter ${target.name}${target.name !== source.name ? ` -> ${source.name}` : ''}: ${changed.join(', ')}`,
        // The live login stays as it is.
        run: () => live('PUT', `/api/employees/${target.id}`, { ...pick(source, EMPLOYEE_FIELDS), userName: target.userName, role: target.role, password: null }),
      })
    } else {
      actions.push({
        text: `Mitarbeiter ${source.name}: neu (ohne Login)`,
        run: () => live('POST', '/api/employees', { ...pick(source, EMPLOYEE_FIELDS), userName: null, role: 'Handwerker', password: null }),
      })
    }
  }
  return { actions, liveOnly: [...unused].map((e) => e.name) }
}

// ---- Construction sites ----

const siteKey = (s) => [s.name, s.street, s.houseNumber, s.postalCode, s.city].map(norm).join('|')

function matchSite(source, candidates) {
  const exact = candidates.find((s) => siteKey(s) === siteKey(source))
  if (exact) return exact
  const byName = candidates.filter((s) => norm(s.name) === norm(source.name))
  return byName.length === 1 ? byName[0] : undefined
}

/** The status changes that lead from the live status to the local one, or null when there is no way. */
function statusPath(from, to) {
  if (from === to) return []
  if (from === 'Storniert') return null
  // Cancelling is no longer possible in the app.
  if (to === 'Storniert') return null
  const order = ['Angebot', 'Bauphase', 'Abgeschlossen']
  const i = order.indexOf(from), j = order.indexOf(to)
  return i >= 0 && j > i ? order.slice(i + 1, j + 1) : null
}

async function syncSites(live, local) {
  const liveList = await live('GET', '/api/sites')
  const localList = await local('GET', '/api/sites')
  // The planner in charge by name.
  const livePlanners = await live('GET', '/api/sites/planners')
  const localPlanners = await local('GET', '/api/sites/planners')
  const plannerId = (localId) => {
    if (localId == null) return null
    const name = localPlanners.find((p) => p.id === localId)?.name
    return livePlanners.find((p) => coreName(p.name) === coreName(name))?.id ?? null
  }
  const unused = new Set(liveList)
  const actions = []
  const notes = []
  for (const source of localList) {
    const target = matchSite(source, [...unused])
    if (target) unused.delete(target)
    // A cancelled site that is not live does not go there (it could not be cancelled there).
    if (!target && source.status === 'Storniert') {
      notes.push(`Baustelle ${source.name}: lokal storniert, live nicht angelegt`)
      continue
    }
    const fields = { ...pick(source, SITE_FIELDS), responsiblePlannerId: plannerId(source.responsiblePlannerId) }
    const changed = target
      ? [...SITE_FIELDS.filter((f) => !same(source[f], target[f])), ...(same(fields.responsiblePlannerId, target.responsiblePlannerId) ? [] : ['Zuständig'])]
      : []
    const start = source.status === 'Angebot' ? 'Angebot' : 'Bauphase'
    const path = statusPath(target?.status ?? start, source.status)
    if (path === null) notes.push(`Baustelle ${source.name}: Status live ${target?.status}, lokal ${source.status}; lässt sich nicht angleichen`)
    const taskUpdates = source.tasks.filter((task) => {
      const current = target?.tasks.find((t) => t.activity === task.activity)
      return current ? current.estimatedDays !== task.estimatedDays || current.notNeeded !== task.notNeeded : task.estimatedDays !== 1 || task.notNeeded
    })
    const parts = [
      ...(target ? [] : ['neu']),
      ...(changed.length ? [changed.join(', ')] : []),
      ...(path?.length ? [`Status ${target?.status ?? start} -> ${path.join(' -> ')}`] : []),
      ...(taskUpdates.length ? [`Tätigkeiten ${taskUpdates.map((t) => t.activity).join(', ')}`] : []),
    ]
    if (parts.length === 0) continue
    actions.push({
      text: `Baustelle ${source.name}: ${parts.join('; ')}`,
      run: async () => {
        let id = target?.id
        if (!target) id = (await live('POST', '/api/sites', { ...fields, status: start })).id
        else if (changed.length) await live('PUT', `/api/sites/${id}`, fields)
        for (const status of path ?? []) await live('POST', `/api/sites/${id}/status`, { status })
        for (const task of taskUpdates)
          await live('PUT', `/api/sites/${id}/tasks/${task.activity}`, { estimatedDays: task.estimatedDays, notNeeded: task.notNeeded }).catch(() =>
            console.log(`  Hinweis: Baustelle ${source.name}, Tätigkeit ${task.activity} nicht übernommen`))
      },
    })
  }
  return { actions, notes, liveOnly: [...unused].map((s) => s.name) }
}

// ---- The plan (entries, vacation, sick days) and the notes, year by year ----

// A day without times is the whole working day, which the server stores as 07:00 to 16:00.
const wholeDay = (e) => (e.startTime == null && e.endTime == null) || (e.startTime?.startsWith('07:00') && e.endTime?.startsWith('16:00'))
const entryKey = (e) =>
  JSON.stringify([e.type, e.siteId ?? null, e.activity ?? null, wholeDay(e) ? 'ganztägig' : [e.startTime, e.endTime], e.note ?? null, !!e.noteImportant])
const dayKey = (entries) => entries.map(entryKey).sort().join('\n')

async function syncPlan(live, local) {
  // Who is who and which site is which, after employees and sites are in line.
  const [liveEmployees, localEmployees, liveSites, localSites] = await Promise.all([
    live('GET', '/api/employees'), local('GET', '/api/employees'), live('GET', '/api/sites'), local('GET', '/api/sites'),
  ])
  const employeeOf = new Map(localEmployees.map((e) => [e.id, matchEmployee(e, liveEmployees)?.id]))
  const siteOf = new Map(localSites.map((s) => [s.id, matchSite(s, liveSites)?.id]))
  const actions = []
  const notes = []
  for (const year of years) {
    const [livePlan, localPlan] = await Promise.all([live('GET', `/api/plan?year=${year}`), local('GET', `/api/plan?year=${year}`)])
    const inYear = (e) => e.date.startsWith(`${year}-`)

    // Plan days: every local day with entries is set live to the same entries.
    const liveDays = new Map()
    for (const e of livePlan.entries.filter(inYear)) {
      const key = `${e.employeeId}|${e.date}`
      liveDays.set(key, [...(liveDays.get(key) ?? []), e])
    }
    const localDays = new Map()
    for (const e of localPlan.entries.filter(inYear)) {
      const key = `${e.employeeId}|${e.date}`
      localDays.set(key, [...(localDays.get(key) ?? []), e])
    }
    const changes = []
    let unmapped = 0
    for (const [key, entries] of localDays) {
      const [localEmployee, date] = key.split('|')
      const employeeId = employeeOf.get(Number(localEmployee))
      const mapped = entries.map((e) => ({
        type: e.type, siteId: e.siteId === null ? null : (siteOf.get(e.siteId) ?? -1), activity: e.activity,
        startTime: e.startTime, endTime: e.endTime, note: e.note, noteImportant: e.noteImportant,
      }))
      if (employeeId === undefined || mapped.some((e) => e.siteId === -1)) {
        unmapped++
        continue
      }
      if (dayKey(mapped) === dayKey(liveDays.get(`${employeeId}|${date}`) ?? [])) continue
      changes.push({ employeeId, date, entries: mapped })
    }
    if (unmapped) notes.push(`${year}: ${unmapped} Tag(e) mit Mitarbeiter oder Baustelle, die live (noch) fehlen`)
    for (let i = 0; i < changes.length; i += MAX_DAYS_PER_BATCH) {
      const batch = changes.slice(i, i + MAX_DAYS_PER_BATCH)
      actions.push({ text: `Plan ${year}: ${batch.length} Tag(e) (${batch.filter((d) => !liveDays.has(`${d.employeeId}|${d.date}`)).length} neu, die anderen überschrieben)`, run: () => live('PUT', '/api/plan/batch', batch) })
    }

    // Notes: by employee, day and title; a different text is overwritten.
    for (const note of localPlan.notes ?? []) {
      if (!inYear(note)) continue
      const employeeId = employeeOf.get(note.employeeId)
      if (employeeId === undefined) continue
      const there = (livePlan.notes ?? []).find((n) => n.employeeId === employeeId && n.date === note.date && norm(n.title) === norm(note.title))
      const input = { employeeId, date: note.date, title: note.title, text: note.text ?? '' }
      if (!there) actions.push({ text: `Notiz ${note.date} „${note.title}“: neu`, run: () => live('POST', '/api/plan/notes', input) })
      else if (!same(there.text ?? '', note.text ?? '')) actions.push({ text: `Notiz ${note.date} „${note.title}“: Text`, run: () => live('PUT', `/api/plan/notes/${there.id}`, input) })
    }
  }
  return { actions, notes }
}

// ---- Main ----

const liveUrl = process.env.WEGO_LIVE_URL ?? 'https://planer.wego-badcenter.de'
const localUrl = new URL(process.env.WEGO_URL ?? 'http://localhost:5284')
if (!['localhost', '127.0.0.1', '[::1]'].includes(localUrl.hostname)) throw new Error(`WEGO_URL must point to a local API, not ${localUrl.origin}`)
const { WEGO_LIVE_USER, WEGO_LIVE_PASSWORD } = process.env
if (!WEGO_LIVE_USER || !WEGO_LIVE_PASSWORD) throw new Error('Set WEGO_LIVE_USER and WEGO_LIVE_PASSWORD (a Planer G account on the live system).')

const live = apiClient(liveUrl, { readOnly: !apply })
const local = apiClient(localUrl.origin, { readOnly: true })
await signIn(live, WEGO_LIVE_USER, WEGO_LIVE_PASSWORD, liveUrl, 'PlanerG')
await signIn(local, process.env.WEGO_USER ?? 'planer', process.env.WEGO_PASSWORD ?? 'wego-dev-2026', localUrl.origin)

// In this order: the plan needs the employees and sites to be there live.
for (const [label, step] of [['Tätigkeiten', syncActivities], ['Mitarbeiter', syncEmployees], ['Baustellen', syncSites], ['Plan und Notizen', syncPlan]]) {
  const { actions, notes = [], liveOnly = [] } = await step(live, local)
  console.log(`\n${label}: ${actions.length} Änderung(en)${apply ? '' : ' (Probelauf)'}`)
  for (const action of actions) {
    console.log(`  ${action.text}`)
    if (apply) await action.run()
  }
  for (const note of notes) console.log(`  Hinweis: ${note}`)
  if (liveOnly.length) console.log(`  Nur live, bleibt unverändert: ${liveOnly.join(', ')}`)
}
if (!apply) console.log('\nNichts geschrieben. Mit --apply übernehmen.')
