/** Handwerker read the plan; Planer A plan; Planer G may do everything (employees, administration). */
export type Role = 'Handwerker' | 'PlanerA' | 'PlanerG'
export type EntryType = 'Baustelle' | 'Urlaub' | 'Krank'
/** The key of an activity (e.g. 'Sanitaer'); the activities themselves are kept under Verwaltung. */
export type Activity = string

/** An activity as the server keeps it: its phase, its place in the order and its colour. */
export interface ActivityDef {
  key: Activity
  label: string
  phase: 'Angebot' | 'Bauphase'
  sortOrder: number
  /** e.g. '#f46a6a' */
  color: string
}

export type ActivityInput = Pick<ActivityDef, 'label' | 'phase' | 'color'>

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
  /** Planners and whoever does offer work: the menu offers the plan of the offer phase. */
  seesOffers?: boolean
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
  /** Telephone number of the customer. */
  clientPhone: string | null
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
  /** The planner in charge; a new site without one goes to whoever creates it. */
  responsiblePlannerId?: number | null
  /** A service call (Serviceeinsatz): work at one appointment, kept out of the lists of sites. */
  isService?: boolean
  /** An appointment the customer has not confirmed yet: in the plan without colour, "? Kunde". */
  isTentative?: boolean
}

/** A planner who can be in charge of a site. */
export interface Planner {
  id: number
  name: string
  /** The signed-in planner. */
  isMe: boolean
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

/** Betriebsferien: the company is closed, every craftsman has vacation on its working days. */
export type HolidayKind = 'Schulferien' | 'Feiertag' | 'Betriebsferien'

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
  /** Planer A or G: does all activities of the offer phase. */
  isPlaner?: boolean
  /** Has a row in the plan: does all activities of the construction phase. Somebody can be both. */
  isCraftsman?: boolean
  /** The birthday, day and month: "MM-DD"; marked in the plan. */
  birthday?: string | null
}

/** Where a site is on the map. */
export interface SiteMapLocation {
  siteId: number
  latitude: number
  longitude: number
}

/** The places of the sites; `pending`: addresses not looked up yet (the map asks again). */
export interface SiteMapLocations {
  locations: SiteMapLocation[]
  pending: number
}

/** A stretch of vacation: days one after the other (a weekend in between does not break it). */
export interface VacationBlock {
  from: string
  to: string
  days: number
}

/** The own vacation in "Mein Bereich"; counted from `countedFrom` on (`counted` false before). */
export interface MyVacation {
  year: number
  counted: boolean
  countedFrom: number
  entitlement: number
  /** All vacation days entered in the year; `taken`: those up to today. */
  used: number
  taken: number
  remaining: number
  blocks: VacationBlock[]
}

/** Planer G: the vacation of one employee, as they see it in "Mein Bereich". */
export interface EmployeeVacation {
  employeeId: number
  name: string
  vacation: MyVacation
}

/** A note in the field of an employee and a day of the plan, not tied to a site. */
export interface CalendarNote {
  id: number
  employeeId: number
  date: string
  /** Short: it stands in the field. */
  title: string
  /** The explanation, shown when pointing at the note. */
  text: string | null
}

export interface CalendarNoteInput {
  employeeId: number
  date: string
  title: string
  text: string
}

export interface Plan {
  year: number
  employees: PlanEmployee[]
  /** Planners not shown in the plan otherwise: they appear in the offer phase. */
  planners?: PlanEmployee[]
  /** false: the viewer does no offer work and does not see the offer phase (its sites and work are left out). */
  offerPhase?: boolean
  entries: Entry[]
  schoolHolidays: SchoolHoliday[]
  sites: Site[]
  notes?: CalendarNote[]
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
  /** Usual wage per hour in euros, for the costing of a site (Planer G only). */
  hourlyRate?: number | null
  phone?: string | null
  /** Deleted by a Planer G: the entries stay, the lists show them at the end. */
  isDeleted?: boolean
  /** Date of birth "YYYY-MM-DD", entered by a Planer G. */
  birthDate?: string | null
}

/** An employee in the list for everybody: no login, no wage; of the date of birth only day and month. */
export type EmployeeOverview = Pick<Employee, 'id' | 'name' | 'role' | 'isActive' | 'showInPlan' | 'phone' | 'isDeleted'> & {
  /** "MM-DD" */
  birthday?: string | null
  /** The whole date of birth, for planners only. */
  birthDate?: string | null
}

/** The wage per hour of an employee on one site, where it differs from the usual one. */
export interface SiteHourlyRate {
  employeeId: number
  hourlyRate: number
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
  hourlyRate: number | null
  phone: string | null
  birthDate?: string | null
  /** Craftsmen: the activity they get on a new site, in its colour. */
  mainActivity: Activity | null
}
