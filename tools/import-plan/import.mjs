// Imports one year sheet of the Excel staff plan ("Projekt_bauplaner.xlsx") through the API.
//
//   node import.mjs <file.xlsx> <year>            dry run: prints what would be imported
//   node import.mjs <file.xlsx> <year> --apply    writes to the application
//   ... --only=sites | --only=plan                restrict to the project list or to the day cells
//
// Environment: WEGO_URL (default http://localhost:5284), WEGO_USER, WEGO_PASSWORD (a Planer account).
//
// How the sheet is read:
// - Row 1 holds, per month, the month name twice and then one column per employee.
// - Rows 2..32 are the days 1..31. The year in the date cells is not reliable, so the date is
//   built from sheet year, month block and row.
// - A text cell is split on "/" into several construction sites of that day.
// - "Krank" becomes a sick day, an empty yellow cell on a working day becomes a vacation day.
// - The fill colour of a cell is the activity of all sites in it (see ACTIVITY_BY_COLOUR).
// - The unnamed last column of each month (office absences, events) is not imported.
// - Below the days each month lists its projects: customer, place, kind of conversion, tiles. They
//   become place and description of the construction sites that already exist under that name.
import ExcelJS from 'exceljs'

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const YELLOW = 'FFFFFF00'

// Fill colours of the planning sheet and the activity they stand for, as the planners explained them.
// Office theme colour 4 (a blue) is matched by its theme number, whatever its tint.
const ACTIVITY_BY_COLOUR = {
  FF4CF5F9: 'Besichtigung', // türkis
  FFFF0000: 'Abriss', // rot
  FFFFC000: 'Trockenbau', // orange
  FF66FFFF: 'Sanitaer', // blau (hell)
  FFFF66FF: 'RenoDeco', // lila / pink-violett
  FFFF99CC: 'Fliesen', // magenta / rosa
  theme4: 'Endmontage', // anderes Blau
}

function activityOf(cell) {
  const colour = cell.fill?.type === 'pattern' ? cell.fill.fgColor : undefined
  if (!colour) return null
  return ACTIVITY_BY_COLOUR[colour.argb] ?? (colour.theme !== undefined ? ACTIVITY_BY_COLOUR[`theme${colour.theme}`] : undefined) ?? null
}

// Different spellings of the same person in the header row.
const EMPLOYEE_ALIASES = { Tsonyo: 'Tsonjo' }
// Columns that stand for a trade instead of a person.
const SKIPPED_COLUMNS = new Set(['Elektro'])

const [file, yearArg, ...flags] = process.argv.slice(2)
const year = Number(yearArg)
const apply = flags.includes('--apply')
const only = flags.find((flag) => flag.startsWith('--only='))?.slice(7)
if (!file || !Number.isInteger(year)) {
  console.error('Usage: node import.mjs <file.xlsx> <year> [--apply]')
  process.exit(1)
}

function text(cell) {
  const value = cell.value
  if (value == null) return ''
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map((part) => part.text).join('')
    if (value.result !== undefined) return String(value.result ?? '')
    return value.text ?? ''
  }
  return String(value)
}

function isYellow(cell) {
  const fill = cell.fill
  return fill?.type === 'pattern' && fill.fgColor?.argb === YELLOW
}

/** "15.00 Stammler" -> { name: "Stammler", note: "ab 15.00" }, "Kuntz mit 2 Helfer" -> note "mit 2 Helfer" */
function parsePart(raw) {
  let name = raw.replace(/\s+/g, ' ').trim()
  const notes = []

  const timeFirst = name.match(/^(\d{1,2}[.:]\d{2})\s+(.+)$/)
  if (timeFirst) {
    notes.push(`ab ${timeFirst[1]}`)
    name = timeFirst[2]
  }
  const timeLast = name.match(/^(.+?)\s+(ab \d{1,2}[.:]\d{2})$/)
  if (timeLast) {
    notes.push(timeLast[2])
    name = timeLast[1]
  }
  const brackets = name.match(/^(.+?)\s*\(([^)]+)\)$/)
  if (brackets) {
    notes.push(brackets[2].trim())
    name = brackets[1]
  }
  const helper = name.match(/^(.+?)\s+((?:mit|m\.)\s.+)$/i)
  if (helper) {
    notes.push(helper[2])
    name = helper[1]
  }

  name = name.replace(/[\s,;]+$/, '').trim()
  return { name, note: notes.join(', ') || null }
}

function parseCell(raw, activity) {
  const value = raw.replace(/\s+/g, ' ').trim()
  if (/^krank$/i.test(value)) return [{ type: 'Krank', customerName: null, activity: null, startTime: null, endTime: null, note: null }]

  const entries = []
  for (const piece of value.split('/')) {
    const { name, note } = parsePart(piece)
    // "frei", "?" and "......" are not places of work.
    if (!/[\p{L}\d]/u.test(name) || /^frei$/i.test(name)) continue
    if (/^krank$/i.test(name)) {
      entries.push({ type: 'Krank', customerName: null, activity: null, startTime: null, endTime: null, note })
      continue
    }
    if (entries.some((e) => e.customerName?.toLowerCase() === name.toLowerCase())) continue
    entries.push({ type: 'Baustelle', customerName: name, activity, startTime: null, endTime: null, note })
  }
  return entries
}

async function readSheet() {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(file)
  const sheet = workbook.getWorksheet(String(year))
  if (!sheet) throw new Error(`The workbook has no sheet "${year}".`)

  const blocks = []
  for (let column = 1; column <= sheet.columnCount; column++) {
    const month = MONTHS.indexOf(text(sheet.getCell(1, column)).trim())
    if (month >= 0 && blocks.at(-1)?.month !== month) blocks.push({ month, start: column })
  }
  if (blocks.length !== 12) throw new Error(`Expected 12 month blocks in row 1, found ${blocks.length}.`)

  const sites = readProjects(sheet, blocks)

  const employees = [] // in the order of first appearance
  const days = [] // { employee, date, entries }
  const pad = (n) => String(n).padStart(2, '0')

  blocks.forEach((block, index) => {
    const end = (blocks[index + 1]?.start ?? sheet.columnCount + 1) - 1
    const daysInMonth = new Date(Date.UTC(year, block.month + 1, 0)).getUTCDate()

    for (let column = block.start + 2; column <= end; column++) {
      const header = text(sheet.getCell(1, column)).trim()
      if (!header || SKIPPED_COLUMNS.has(header)) continue
      const employee = EMPLOYEE_ALIASES[header] ?? header
      if (!employees.includes(employee)) employees.push(employee)

      for (let day = 1; day <= daysInMonth; day++) {
        const date = `${year}-${pad(block.month + 1)}-${pad(day)}`
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
        const cell = sheet.getCell(1 + day, column)
        const value = text(cell).trim()

        let entries = []
        if (value) entries = parseCell(value, activityOf(cell))
        else if (isYellow(cell) && weekday !== 0 && weekday !== 6)
          entries = [{ type: 'Urlaub', customerName: null, activity: null, startTime: null, endTime: null, note: null }]

        if (entries.length > 0) days.push({ employee, date, entries })
      }
    }
  })

  return { employees, days, sites }
}

// A postal code, a street, or one of the districts and towns the company works in.
const PLACE =
  /^\d{5}\b|\b(chaussee|straße|str\.|weg|allee|damm|platz)\b|\b(karow|bernau|panketal|buch|buchholz|wilhelmsruh|schildow|schlidow|weissensee|weißensee|glienicke|falkenberg|pankow|niederschönhausen|reinickendorf|konradshöhe|lübars|neuendorf)\b/i

/** The project list below the day rows: one row per project, laid out a little differently every month. */
function readProjects(sheet, blocks) {
  const sites = new Map() // lower-case name -> { name, location, description, month }

  blocks.forEach((block, index) => {
    const end = (blocks[index + 1]?.start ?? sheet.columnCount + 1) - 1
    for (let row = 33; row <= sheet.rowCount; row++) {
      const cells = []
      for (let column = block.start + 2; column <= end; column++) {
        const value = text(sheet.getCell(row, column)).replace(/\s+/g, ' ').trim()
        if (value) cells.push({ offset: column - block.start, value })
      }
      // The name is the first cell and stands directly next to the date columns.
      if (cells.length === 0 || cells[0].offset > 3) continue

      const name = cells[0].value.replace(/[\s/,;]+$/, '')
      const rest = cells.slice(1).map((cell) => cell.value)
      const location = rest.find((value) => PLACE.test(value)) ?? null
      const description = rest.filter((value) => value !== location).join('; ') || null

      const key = name.toLowerCase()
      const known = sites.get(key)
      if (known && known.month === block.month) {
        // Two jobs for the same customer in one month.
        known.description = [known.description, description].filter(Boolean).join(' / ') || null
        known.location ??= location
      } else {
        sites.set(key, { name, location, description, month: block.month })
      }
    }
  })

  return [...sites.values()]
}

/** The site a project row belongs to: same name, or the name without first name or addition. */
function matchSite(project, customers) {
  const byName = new Map(customers.map((customer) => [customer.name.toLowerCase(), customer]))
  return byName.get(project.name.toLowerCase()) ?? byName.get(project.name.split(/[\s,]+/)[0].toLowerCase()) ?? null
}

function summarize({ employees, days, sites }) {
  const count = (type) => days.reduce((n, d) => n + d.entries.filter((e) => e.type === type).length, 0)
  const customers = new Map()
  for (const day of days) {
    for (const entry of day.entries) {
      if (entry.type !== 'Baustelle') continue
      const key = entry.customerName.toLowerCase()
      customers.set(key, { name: customers.get(key)?.name ?? entry.customerName, days: (customers.get(key)?.days ?? 0) + 1 })
    }
  }

  console.log(`Sheet ${year}: ${days.length} employee days, ${count('Baustelle')} site entries, ${count('Urlaub')} vacation days, ${count('Krank')} sick days`)
  console.log(`Split days (more than one entry): ${days.filter((d) => d.entries.length > 1).length}`)
  const activities = {}
  for (const day of days) for (const entry of day.entries) {
    if (entry.type === 'Baustelle') activities[entry.activity ?? '(ohne)'] = (activities[entry.activity ?? '(ohne)'] ?? 0) + 1
  }
  console.log(`Activities of site entries: ${Object.entries(activities).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  console.log(`Employees (${employees.length}): ${employees.join(', ')}`)
  for (const employee of employees) {
    const own = days.filter((d) => d.employee === employee)
    const of = (type) => own.filter((d) => d.entries.some((e) => e.type === type)).length
    console.log(`  ${employee.padEnd(16)} sites ${String(of('Baustelle')).padStart(3)} days, vacation ${String(of('Urlaub')).padStart(2)}, sick ${String(of('Krank')).padStart(2)}`)
  }
  const sorted = [...customers.values()].sort((a, b) => b.days - a.days)
  console.log(`Construction sites (${sorted.length} distinct names), most used: ${sorted.slice(0, 15).map((c) => `${c.name} (${c.days})`).join(', ')}`)
  console.log(`Names used only once: ${sorted.filter((c) => c.days === 1).length}`)

  console.log(`Project list: ${sites.length} projects, ${sites.filter((s) => s.location).length} with a place`)
  for (const site of sites) {
    console.log(`  ${site.name.padEnd(20)} ${(site.location ?? '-').padEnd(26)} ${site.description ?? ''}`)
  }
}

async function importAll({ employees, days, sites }) {
  const base = process.env.WEGO_URL ?? 'http://localhost:5284'
  const { WEGO_USER: userName, WEGO_PASSWORD: password } = process.env
  if (!userName || !password) throw new Error('Set WEGO_USER and WEGO_PASSWORD (a Planer account).')

  let cookie = ''
  const call = async (method, path, body) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`)
    const setCookie = response.headers.getSetCookie?.()[0]
    if (setCookie) cookie = setCookie.split(';')[0]
    return response.status === 204 ? null : response.json()
  }

  await call('POST', '/api/auth/login', { userName, password })

  if (only !== 'sites') await importPlan(call, base, employees, days)
  if (only !== 'plan') await importSites(call, base, sites)
}

async function importSites(call, base, sites) {
  const customers = await call('GET', '/api/customers')
  let updated = 0
  const unmatched = []
  for (const project of sites) {
    const customer = matchSite(project, customers)
    if (!customer) {
      unmatched.push(project.name)
      continue
    }
    // What a planner already entered in the application is kept.
    const location = customer.location ?? project.location
    const description = customer.description ?? project.description
    if (location === customer.location && description === customer.description) continue
    const saved = await call('PUT', `/api/customers/${customer.id}`, { name: customer.name, location, description })
    Object.assign(customer, saved)
    updated++
  }
  console.log(
    `Sites in ${base}: ${updated} updated, ${unmatched.length} projects without a site of that name` +
      (unmatched.length ? `: ${unmatched.join(', ')}` : ''),
  )
}

async function importPlan(call, base, employees, days) {
  const existing = await call('GET', '/api/employees')
  const ids = new Map(existing.map((e) => [e.name.toLowerCase(), e.id]))
  let created = 0
  for (const [index, name] of employees.entries()) {
    if (ids.has(name.toLowerCase())) continue
    const employee = await call('POST', '/api/employees', {
      name, sortOrder: (index + 1) * 10, isActive: true, showInPlan: true, vacationDaysPerYear: 30,
      userName: null, role: 'Mitarbeiter', password: null,
    })
    ids.set(name.toLowerCase(), employee.id)
    created++
  }

  let saved = 0
  const failed = []
  for (const day of days) {
    try {
      await call('PUT', `/api/plan/${ids.get(day.employee.toLowerCase())}/${day.date}`, day.entries)
      saved++
    } catch (error) {
      failed.push(`${day.date} ${day.employee}: ${error.message}`)
    }
  }

  console.log(`Imported into ${base}: ${created} employees created, ${saved} days saved, ${failed.length} failed`)
  for (const line of failed.slice(0, 20)) console.log('  ' + line)
  if (failed.length > 0) process.exitCode = 1
}

const data = await readSheet()
summarize(data)
if (apply) await importAll(data)
else console.log('Dry run. Add --apply to import.')
