import { useState, type FormEvent } from 'react'
import { api, ApiError, messageOf } from '../api/client'
import type { User } from '../api/types'
import logo from '../assets/logo.svg'

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [userName, setUserName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onLogin(await api.login(userName, password))
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
