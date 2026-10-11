export type Role = 'Planer' | 'Mitarbeiter'
export type EntryType = 'Baustelle' | 'Urlaub' | 'Krank'

export interface User {
  id: number
  name: string
  userName: string
  role: Role
}

export interface NamedItem {
  id: number
  name: string
}

export interface SchoolHoliday {
  id: number
  name: string
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
  startTime: string | null
  endTime: string | null
  note: string | null
}

export interface Plan {
  year: number
  employees: NamedItem[]
  entries: Entry[]
  schoolHolidays: SchoolHoliday[]
  customers: NamedItem[]
}

export interface DayEntryInput {
  type: EntryType
  customerName: string | null
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
  vacation: Vacation | null
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
