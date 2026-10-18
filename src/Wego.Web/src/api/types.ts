export type Role = 'Planer' | 'Mitarbeiter'
export type EntryType = 'Baustelle' | 'Urlaub' | 'Krank'
/** What is done on a site that day, in the order of the job. */
export type Activity = 'Besichtigung' | 'Abriss' | 'Trockenbau' | 'Sanitaer' | 'RenoDeco' | 'Fliesen' | 'Endmontage'

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

/** A construction site, named after the customer. */
export interface Customer extends NamedItem {
  location: string | null
  description: string | null
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
  customerId: number | null
  customerName: string | null
  activity: Activity | null
  startTime: string | null
  endTime: string | null
  note: string | null
}

export interface Plan {
  year: number
  employees: NamedItem[]
  entries: Entry[]
  schoolHolidays: SchoolHoliday[]
  customers: Customer[]
}

export interface DayEntryInput {
  type: EntryType
  customerName: string | null
  activity: Activity | null
  startTime: string | null
  endTime: string | null
  note: string | null
}

export interface ReportRow {
  id: number
  name: string
  days: number
  hours: number
}

export interface CustomerReport {
  customerId: number
  customerName: string
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
  customers: ReportRow[]
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
}
