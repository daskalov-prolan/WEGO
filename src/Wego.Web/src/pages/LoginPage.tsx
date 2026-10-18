import { Alert, Button, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError, messageOf } from '../api/client'
import type { User } from '../api/types'
import logo from '../assets/logo.svg'

function LoginFrame({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      <Paper className="login-card" shadow="xl" radius="md">
        <div className="login-logo">
          <img src={logo} alt="WEGO Badcenter" />
        </div>
        {children}
      </Paper>
    </div>
  )
}

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
    <LoginFrame>
      <form onSubmit={submit}>
        <Stack gap="md" p="lg">
          <Title order={2} c="wego.9">
            Personaleinsatzplanung
          </Title>
          <TextInput
            label="Benutzername"
            value={userName}
            onChange={(e) => setUserName(e.currentTarget.value)}
            autoComplete="username"
            required
            size="md"
          />
          <PasswordInput
            label="Passwort"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete="current-password"
            required
            size="md"
          />
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          <Button type="submit" loading={busy} size="md">
            Anmelden
          </Button>
        </Stack>
      </form>
    </LoginFrame>
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
    <LoginFrame>
      <form onSubmit={submit}>
        <Stack gap="md" p="lg">
          <Title order={2} c="wego.9">
            Eigenes Passwort wählen
          </Title>
          <Text c="dimmed" size="sm">
            Hallo {user.name}, bitte ersetzen Sie das Startpasswort durch ein eigenes, das nur Sie kennen.
          </Text>
          {!knownPassword && (
            <PasswordInput
              label="Startpasswort"
              value={current}
              onChange={(e) => setCurrent(e.currentTarget.value)}
              required
            />
          )}
          <PasswordInput
            label="Neues Passwort"
            description="Mindestens 8 Zeichen"
            value={next}
            onChange={(e) => setNext(e.currentTarget.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <PasswordInput
            label="Neues Passwort wiederholen"
            value={repeat}
            onChange={(e) => setRepeat(e.currentTarget.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          <Button type="submit">Speichern</Button>
          <Button variant="subtle" color="gray" onClick={onLogout}>
            Abmelden
          </Button>
        </Stack>
      </form>
    </LoginFrame>
  )
}
