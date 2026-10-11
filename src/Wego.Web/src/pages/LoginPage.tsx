import { useState, type FormEvent } from 'react'
import { api, ApiError, messageOf } from '../api/client'
import type { User } from '../api/types'
import logo from '../assets/logo.svg'

export function LoginPage({ onLogin }: { onLogin: (user: User, password: string) => void }) {
  const [userName, setUserName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onLogin(await api.login(userName, password), password)
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? 'Benutzername oder Passwort ist nicht korrekt.'
          : messageOf(e),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <div className="login-logo">
          <img src={logo} alt="WEGO Badcenter" />
        </div>
        <h1>Personaleinsatzplanung</h1>
        <label className="field">
          Benutzername
          <input value={userName} onChange={(e) => setUserName(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          Passwort
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Anmelden
        </button>
      </form>
    </div>
  )
}

interface NewPasswordProps {
  user: User
  /** The password just used to sign in, if the user came from the login form. */
  knownPassword: string
  onDone: () => void
  onLogout: () => void
}

/** Shown after signing in with a password a planner assigned: the employee chooses their own. */
export function NewPasswordPage({ user, knownPassword, onDone, onLogout }: NewPasswordProps) {
  const [current, setCurrent] = useState(knownPassword)
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (next !== repeat) {
      setError('Die beiden neuen Passwörter stimmen nicht überein.')
      return
    }
    try {
      await api.changePassword(current, next)
      onDone()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <div className="login-logo">
          <img src={logo} alt="WEGO Badcenter" />
        </div>
        <h1>Eigenes Passwort wählen</h1>
        <p className="muted" style={{ margin: 0 }}>
          Hallo {user.name}, bitte ersetzen Sie das Startpasswort durch ein eigenes, das nur Sie kennen.
        </p>
        {!knownPassword && (
          <label className="field">
            Startpasswort
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </label>
        )}
        <label className="field">
          Neues Passwort (mindestens 8 Zeichen)
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <label className="field">
          Neues Passwort wiederholen
          <input
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-primary">
          Speichern
        </button>
        <button type="button" className="btn" onClick={onLogout}>
          Abmelden
        </button>
      </form>
    </div>
  )
}
