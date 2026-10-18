import type {
  Access,
  Customer,
  CustomerReport,
  DayEntryInput,
  Employee,
  EmployeeInput,
  EmployeeReport,
  Entry,
  HolidayKind,
  NamedItem,
  Plan,
  SchoolHoliday,
  User,
  Vacation,
} from './types'

export const UNAUTHORIZED_EVENT = 'wego:unauthorized'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })

  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    throw new ApiError(response.status, await errorMessage(response))
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json()
    if (typeof data?.message === 'string') return data.message
    if (typeof data?.detail === 'string') return data.detail
  } catch {
    // no JSON body
  }
  if (response.status === 403) return 'Dafür fehlt Ihnen die Berechtigung.'
  if (response.status === 429) return 'Zu viele Versuche. Bitte warten Sie einen Moment.'
  return `Die Anfrage ist fehlgeschlagen (${response.status}).`
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Unbekannter Fehler.'
}

export const api = {
  me: () => request<User>('GET', '/api/auth/me'),
  login: (userName: string, password: string) => request<User>('POST', '/api/auth/login', { userName, password }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('POST', '/api/auth/password', { currentPassword, newPassword }),

  plan: (year: number) => request<Plan>('GET', `/api/plan?year=${year}`),
  saveDay: (employeeId: number, date: string, entries: DayEntryInput[]) =>
    request<Entry[]>('PUT', `/api/plan/${employeeId}/${date}`, entries),
  /** Replaces the entries of several employee days in one transaction. */
  saveDays: (days: { employeeId: number; date: string; entries: DayEntryInput[] }[]) =>
    request<Entry[]>('PUT', '/api/plan/batch', days),

  customers: () => request<Customer[]>('GET', '/api/customers'),
  updateCustomer: (id: number, input: Omit<Customer, 'id'>) =>
    request<Customer>('PUT', `/api/customers/${id}`, input),

  customerReport: (id: number, year: number) =>
    request<CustomerReport>('GET', `/api/reports/customers/${id}?year=${year}`),
  employeeReport: (id: number, year: number) =>
    request<EmployeeReport>('GET', `/api/reports/employees/${id}?year=${year}`),
  vacationOverview: (year: number) => request<Vacation[]>('GET', `/api/reports/vacation?year=${year}`),

  employeeNames: () => request<NamedItem[]>('GET', '/api/employees/names'),
  employees: () => request<Employee[]>('GET', '/api/employees'),
  createEmployee: (input: EmployeeInput) => request<Employee>('POST', '/api/employees', input),
  updateEmployee: (id: number, input: EmployeeInput) => request<Employee>('PUT', `/api/employees/${id}`, input),

  createAccess: (id: number) => request<Access>('POST', `/api/employees/${id}/access`),

  addSchoolHoliday: (name: string, startDate: string, endDate: string, kind: HolidayKind) =>
    request<SchoolHoliday>('POST', '/api/schoolholidays', { name, startDate, endDate, kind }),
  deleteSchoolHoliday: (id: number) => request<void>('DELETE', `/api/schoolholidays/${id}`),
  importSchoolHolidays: (year: number) =>
    request<{ imported: number; total: number }>('POST', `/api/schoolholidays/import?year=${year}`),
}
