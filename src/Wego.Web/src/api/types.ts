export type Role = 'Planer' | 'Mitarbeiter'
export type EntryType = 'Baustelle' | 'Urlaub' | 'Krank'
/** What is done on a site that day, in the order of the job. */
export type Activity =
  | 'Besichtigung'
  | 'Angebotskalkulation'
  | 'Angebotsbesprechung'
  | 'Abriss'
  | 'Trockenbau'
  | 'Sanitaer'
  | 'RenoDeco'
  | 'Fliesen'
  | 'Endmontage'

/** Where a construction site stands: offer, construction, done, or cancelled. */
export type SiteStatus = 'Angebot' | 'Bauphase' | 'Abgeschlossen' | 'Storniert'

export interface StatusChange {
  from: SiteStatus | null
  to: SiteStatus
  /** ISO date and time (UTC) */
  changedAt: string
  changedBy: string | null
}

export interface User {
  id: number
  name: string
  userName: string
  role: Role
  /** The user has a column of their own in the plan, i.e. is scheduled on construction sites. */
  showInPlan: boolean
  mustChangePassword: boolean
}

export interface Access {
  employeeId: number
  name: string
  userName: string
  initialPassword: string
}

export interface NamedItem {
  id: number
  name: string
}

/** Which field names a construction site in the plan. */
export type SiteNameSource = 'Auftraggeber' | 'Strasse'

/** What a planner enters for a construction site. */
export interface SiteInput {
  /** Auftraggeber: the customer or the property management. */
  client: string | null
  /** Number of the project in Label, the merchandise management software. */
  labelProjectNumber: string | null
  street: string | null
  houseNumber: string | null
  addressAddition: string | null
  postalCode: string | null
  city: string | null
  nameSource: SiteNameSource
  description: string | null
  /** yyyy-MM-dd */
  plannedStart: string | null
  plannedEnd: string | null
  /** Only when a site is created; later the status changes on its own. */
  status?: SiteStatus
}

/** A construction site (Baustelle). The name is derived from the client or the street. */
/** An activity a site needs in its status, with the employee days it is expected to take. */
export interface SiteTask {
  activity: Activity
  estimatedDays: number
  notNeeded: boolean
}

export interface Site extends NamedItem, SiteInput {
  status: SiteStatus
  tasks: SiteTask[]
}

export type HolidayKind = 'Schulferien' | 'Feiertag'

/** A school holiday period or a public holiday (Feiertag) in Berlin. */
export interface SchoolHoliday {
  id: number
  name: string
  kind: HolidayKind
  startDate: string
  endDate: string
}

/** Dates are "yyyy-MM-dd", times "HH:mm:ss". */
export interface Entry {
  id: number
  employeeId: number
  employeeName: string
  date: string
  type: EntryType
  siteId: number | null
  siteName: string | null
  activity: Activity | null
  startTime: string | null
  endTime: string | null
  note: string | null
  /** The note is very important: shown with a red exclamation mark. */
  noteImportant: boolean
}

/** An employee column of the plan, with what the employee can do. */
export interface PlanEmployee extends NamedItem {
  mainActivity: Activity | null
  additionalActivities: Activity[]
}

export interface Plan {
  year: number
  employees: PlanEmployee[]
  entries: Entry[]
  schoolHolidays: SchoolHoliday[]
  sites: Site[]
}

export interface DayEntryInput {
  type: EntryType
  siteId: number | null
  activity: Activity | null
  startTime: string | null
  endTime: string | null
  note: string | null
  noteImportant: boolean
}

export interface ReportRow {
  id: number
  name: string
  days: number
  hours: number
}

export interface SiteReport {
  siteId: number
  siteName: string
  year: number
  totalDays: number
  totalHours: number
  employees: ReportRow[]
  entries: Entry[]
}

export interface Vacation {
  employeeId: number
  employeeName: string
  entitlement: number
  used: number
  remaining: number
  sickDays: number
}

export interface EmployeeReport {
  employeeId: number
  employeeName: string
  year: number
  totalDays: number
  totalHours: number
  sites: ReportRow[]
  entries: Entry[]
  vacation: Vacation
}

export interface Employee {
  id: number
  name: string
  sortOrder: number
  isActive: boolean
  showInPlan: boolean
  vacationDaysPerYear: number
  userName: string | null
  role: Role
  hasPassword: boolean
  mainActivity: Activity | null
  additionalActivities: Activity[]
}

export interface EmployeeInput {
  name: string
  sortOrder: number
  isActive: boolean
  showInPlan: boolean
  vacationDaysPerYear: number
  userName: string | null
  role: Role
  password: string | null
  mainActivity: Activity | null
  additionalActivities: Activity[]
}
