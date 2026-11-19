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
/** Abgelehnt: the customer said no to the offer, with a reason. */
export type SiteStatus = 'Angebot' | 'Bauphase' | 'Abgeschlossen' | 'Storniert' | 'Abgelehnt'

/** A site set to done by a Planer A that no Planer G has seen yet. */
export interface DoneReport {
  id: number
  siteId: number
  siteName: string
  /** ISO date and time (UTC) */
  changedAt: string
  changedBy: string | null
}

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
  /** Planners and the craftsmen given Besichtigung: they plan visits. */
  doesVisits?: boolean
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
  /** Anrede of the customer: Herr, Frau, Familie. */
  salutation?: string | null
  /** Telephone number of the customer. */
  clientPhone: string | null
  /** A second number: many customers give the landline and the mobile. */
  clientPhone2?: string | null
  /** Only when a service call is created: the craftsman is to confirm it first. */
  needsConfirmation?: boolean
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
  /** yyyy-MM-dd: the day the enquiry came in (Anfrage), where the offer phase begins; a new site: today. */
  requestedOn?: string | null
  /** What the customer would like done (Umfang), from SCOPES; left out it stays. */
  scope?: string[]
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

/** Where the confirmation of a service call by the craftsman stands; null when confirmed or never asked. */
export type Confirmation = 'Offen' | 'Abgelehnt'

export interface Site extends NamedItem, SiteInput {
  status: SiteStatus
  tasks: SiteTask[]
  confirmation?: Confirmation | null
  /** Why the craftsman said no, and who answered. */
  confirmationNote?: string | null
  confirmationBy?: string | null
  /** Why the customer said no (a declined offer), with a few words. */
  declineReason?: string | null
  declineNote?: string | null
}

/** One appointment of a step of the offer phase: an entry in the plan of an employee. Times "HH:mm:ss". */
export interface OfferStep {
  siteId: number
  activity: Activity
  entryId: number
  employeeId: number
  employeeName: string
  date: string
  startTime: string | null
  endTime: string | null
}

/** A site decided lately: into the construction phase (Zusage) or declined. */
export interface DecidedOffer {
  siteId: number
  name: string
  status: SiteStatus
  decidedAt: string
  plannedStart: string | null
  declineReason: string | null
  declineNote: string | null
  /** Where the customer said no: Besichtigung, Objektauswahl, Angebotsuebergabe or Wartet. */
  declineStep?: string | null
}

/** A no reported by who visits (on the telephone), waiting for a planner to confirm it; at: UTC. */
export interface DeclineReport {
  siteId: number
  reason: string
  note: string | null
  by: string
  at: string
}

/** The offer phase as an overview: the enquiries, their steps (in the order of stepActivities), the decided. */
export interface Offers {
  sites: Site[]
  steps: OfferStep[]
  stepActivities: Activity[]
  decided: DecidedOffer[]
  /** Customers called for the visit and not reached: the last call of each enquiry. */
  calls?: CallAttempt[]
  /** Noes reported by who visits, for a planner to confirm. */
  reports?: DeclineReport[]
}

/** A customer called and not reached: the last time (UTC), by whom, how often in all. */
export interface CallAttempt {
  siteId: number
  at: string
  by: string
  count: number
}

export interface VisitPlace {
  name: string
  address: string
  latitude: number
  longitude: number
}

/** A customer planned on a day of visits; from/to "HH:mm:ss". */
export interface PlannedVisit {
  entryId: number
  siteId: number
  name: string
  address: string | null
  phone: string | null
  phone2?: string | null
  latitude: number | null
  longitude: number | null
  from: string
  to: string
  /** That of the planner of the enquiry. */
  region?: string | null
}

/** A day of visits of one who goes out: set aside by the planners, or with a customer planned on its own. */
export interface VisitDay {
  date: string
  employeeId: number
  employee: string
  visits: PlannedVisit[]
  /** Set aside for visits by the planners; else a day with a customer planned on its own. */
  reserved?: boolean
}

/** An enquiry without a visit yet; region: that of its planner. */
export interface VisitEnquiry {
  siteId: number
  name: string
  address: string | null
  phone: string | null
  phone2?: string | null
  scope: string[]
  description: string | null
  requestedOn: string | null
  planner: string | null
  region: string | null
  latitude: number | null
  longitude: number | null
  call: CallAttempt | null
  /** A no reported, waiting for a planner to confirm it. */
  report?: DeclineReport | null
}

/** Something else in the plan of the visitor; without times the whole day. */
export interface VisitBusy {
  date: string
  name: string
  from: string | null
  to: string | null
}

export interface VisitPlan {
  employeeId: number
  /** The branches of WEGO, as stars on the map. */
  branches: VisitPlace[]
  /** Whom a planner may plan for; empty for a craftsman, who plans his own. */
  visitors: { id: number; name: string }[]
  regions: string[]
  /** The days of visits of all who go out. */
  days: VisitDay[]
  enquiries: VisitEnquiry[]
  busy: VisitBusy[]
  /** Enquiries whose address is not on the map yet. */
  pending: number
  /** Why a customer says no while the visit is agreed. */
  declineReasons: string[]
}

export interface StepInput {
  activity: Activity
  employeeIds: number[]
  /** yyyy-MM-dd, times HH:mm */
  date: string
  startTime: string
  endTime: string
  /** One more appointment of a step that may have several (Objektauswahl). */
  another?: boolean
  /** The day of the appointment moved, when the step has several. */
  from?: string
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
  /** A service call waiting for the craftsman to confirm it (dashed), or one he said no to. */
  confirmation?: Confirmation | null
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

export type AbsenceType = Exclude<EntryType, 'Baustelle'>

/** Urlaub or Krank over working days one after the other (weekends and public holidays in between belong to it). */
export interface Absence {
  employeeId: number
  employeeName: string
  type: AbsenceType
  from: string
  to: string
  workDays: number
}

export interface AbsenceRange {
  employeeId: number
  type: AbsenceType
  from: string
  to: string
}

/** `force`: also over days with sites planned (they give way); `replaces`: the stretch changed. */
export interface AbsenceInput extends AbsenceRange {
  force?: boolean
  replaces?: AbsenceRange | null
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
  /** The birthdays of everybody active, planners as well ("MM-DD"). */
  birthdays?: { employeeId: number; name: string; birthday: string }[]
  /** The weeks of the meetings that come back every week (e.g. the Bauberatung). */
  meetings?: MeetingWeek[]
  /** Times busy after the own calendars of the employees (e.g. Apple's), without what they are. */
  busy?: OwnBusy[]
}

/** A time busy after an own calendar; without times the whole day. */
export interface OwnBusy {
  employeeId: number
  date: string
  startTime: string | null
  endTime: string | null
}

/** Mein Bereich: the link to the own appointments, and the own calendar shared with the plan. */
export interface MyCalendar {
  link: string | null
  /** His own calendars shared with the plan (e.g. Privat, Arbeit), each read on its own. */
  calendars: OwnCalendar[]
}

/** One own calendar: busy the times read from it; error why it could not be read the last time. */
export interface OwnCalendar {
  id: number
  url: string
  syncedAt: string | null
  error: string | null
  busy: number
}

/**
 * One week of a meeting: date the day it is on, originalDate the day of the series (another when moved);
 * employeeIds those there that day, requested those of them who asked to be let off.
 */
export interface MeetingWeek {
  meetingId: number
  title: string
  date: string
  originalDate: string
  startTime: string
  endTime: string
  employeeIds: number[]
  moved: boolean
  requested: number[]
  /** The names of the participants by id (also for a craftsman who does not see the planners). */
  names: Record<number, string>
}

/** A meeting every week; weekday 1 Monday to 7 Sunday. */
export interface Meeting {
  id: number
  title: string
  weekday: number
  startTime: string
  endTime: string
  startsOn: string
  endsOn: string | null
  participantIds: number[]
  changes: { date: string; cancelled: boolean; newDate: string | null; newStartTime: string | null; newEndTime: string | null }[]
  absences: { date: string; employeeId: number; reason: string | null; status: 'Beantragt' | 'Freigegeben' | 'Abgelehnt'; requestedAt: string }[]
}

export interface MeetingInput {
  title: string
  weekday: number
  startTime: string
  endTime: string
  startsOn: string
  endsOn: string | null
  participantIds: number[]
}

/** A request to be let off one week, for a planner of group G. */
export interface MeetingRequest {
  meetingId: number
  title: string
  date: string
  employeeId: number
  employee: string
  reason: string | null
  requestedAt: string
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
  /** Planners: the region of their enquiries, for the tours of visits. */
  region?: string | null
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
  /** Craftsmen: activities of the offer phase they do as well, e.g. visits ("Besichtigung"). */
  additionalActivities?: Activity[]
  /** Planners: the region of their enquiries (Karow, Reinickendorf). */
  region?: string | null
}
