import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, messageOf } from '../api/client'
import type { User } from '../api/types'
import logo from '../assets/logo.svg'
import { CURRENT_YEAR } from '../lib/dates'

interface Props {
  user: User
  page: string
  year: number
  onYearChange: (year: number) => void
  onLogout: () => void
  children: ReactNode
}

const NAV = [
  { page: 'mein-plan', label: 'Mein Plan', visible: (user: User) => user.showInPlan },
  { page: 'plan', label: 'Gesamtplan', visible: () => true },
  { page: 'baustellen', label: 'Baustellen', visible: (user: User) => user.role === 'Planer' },
  { page: 'mitarbeiter', label: 'Mitarbeiter', visible: (user: User) => user.role === 'Planer' },
  { page: 'verwaltung', label: 'Verwaltung', visible: (user: User) => user.role === 'Planer' },
]

export function AppShell({ user, page, year, onYearChange, onLogout, children }: Props) {
  const passwordDialog = useRef<HTMLDialogElement>(null)
  const years = [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1]

  return (
    <div className="shell">
      <header className="shell-header">
        <img src={logo} alt="WEGO Badcenter" />
        <span className="shell-title">Personaleinsatzplanung</span>
        <div className="shell-user">
          <select aria-label="Jahr" value={year} onChange={(e) => onYearChange(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          <span className="shell-user-name">
            {user.name} ({user.role})
          </span>
          <button type="button" onClick={() => passwordDialog.current?.showModal()}>
            Passwort<span className="wide-only"> ändern</span>
          </button>
          <button type="button" onClick={onLogout}>
            Abmelden
          </button>
        </div>
      </header>

      <nav className="shell-nav" aria-label="Hauptnavigation">
        {NAV.filter((item) => item.visible(user)).map((item) => (
          <a key={item.page} href={`#/${item.page}`} aria-current={page === item.page ? 'page' : undefined}>
            {item.label}
          </a>
        ))}
      </nav>


      <main className="shell-main">{children}</main>

      <dialog ref={passwordDialog}>
        <PasswordForm onClose={() => passwordDialog.current?.close()} />
      </dialog>
    </div>
  )
}

function PasswordForm({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState('')

  const close = () => {
    setCurrent('')
    setNext('')
    setError('')
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await api.changePassword(current, next)
      close()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <form onSubmit={submit}>
      <h2>Passwort ändern</h2>
      <div className="toolbar">
        <label className="field">
          Aktuelles Passwort
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="field">
          Neues Passwort (mindestens 8 Zeichen)
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="dialog-actions">
        <button type="submit" className="btn btn-primary">
          Speichern
        </button>
        <button type="button" className="btn" onClick={close}>
          Abbrechen
        </button>
      </div>
    </form>
  )
}
