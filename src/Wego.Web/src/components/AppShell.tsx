import { Alert, Button, Group, Menu, NativeSelect, PasswordInput, Stack, Text, UnstyledButton } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useState, type FormEvent, type ReactNode } from 'react'
import { api, messageOf } from '../api/client'
import type { User } from '../api/types'
import logo from '../assets/logo.svg'
import { CURRENT_YEAR } from '../lib/dates'
import { canPlanRole, roleLabel } from '../lib/roles'
import { Sheet } from './Sheet'

interface Props {
  user: User
  page: string
  year: number
  onYearChange: (year: number) => void
  onLogout: () => void
  children: ReactNode
}

// Left the plans (the own one, and the plan of everybody per phase), right the records.
const NAV = [
  { page: 'mein-plan', label: 'Mein Plan', visible: (user: User) => user.showInPlan },
  { page: 'angebotsphase', label: 'Planung Angebotsphase', visible: (user: User) => user.seesOffers !== false },
  { page: 'bauphase', label: 'Planung Bauphase', visible: () => true },
  { page: 'baustellen', label: 'Baustellen', visible: (user: User) => canPlanRole(user.role), right: true },
  { page: 'mitarbeiter', label: 'Mitarbeiter', visible: () => true, right: true },
  { page: 'verwaltung', label: 'Verwaltung', visible: (user: User) => user.role === 'PlanerG', right: true },
]

export function AppShell({ user, page, year, onYearChange, onLogout, children }: Props) {
  const [changingPassword, setChangingPassword] = useState(false)
  // A year paged to in the plan beyond these is offered as well.
  const years = [...new Set([CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1, year])].sort((a, b) => a - b).map(String)

  return (
    <div className="shell">
      <header className="shell-header">
        <img src={logo} alt="WEGO Badcenter" />
        <span className="shell-title">Personaleinsatzplanung</span>
        <Group gap="xs" ml="auto" wrap="nowrap">
          <NativeSelect
            aria-label="Jahr"
            size="xs"
            value={String(year)}
            onChange={(e) => onYearChange(Number(e.currentTarget.value))}
            data={years}
            className="year-select"
          />
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <UnstyledButton className="user-button" aria-label="Benutzermenü">
                <span className="user-initials">
                  {user.name
                    .split(/\s+/)
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </span>
                <span className="shell-user-name">{user.name}</span>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>
                {user.name} · {roleLabel(user.role)}
              </Menu.Label>
              <Menu.Item onClick={() => setChangingPassword(true)}>Passwort ändern</Menu.Item>
              <Menu.Item color="red" onClick={onLogout}>
                Abmelden
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </header>

      <nav className="shell-nav" aria-label="Hauptnavigation">
        {NAV.filter((item) => item.visible(user)).map((item, index, shown) => (
          <a
            key={item.page}
            href={`#/${item.page}`}
            aria-current={page === item.page ? 'page' : undefined}
            // The first of the records starts the group on the right.
            className={item.right && !shown[index - 1]?.right ? `nav-${item.page} nav-right` : `nav-${item.page}`}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <main className="shell-main">{children}</main>

      {changingPassword && <PasswordForm onClose={() => setChangingPassword(false)} />}
    </div>
  )
}

function PasswordForm({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await api.changePassword(current, next)
      notifications.show({ message: 'Passwort geändert.', color: 'green' })
      onClose()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <Sheet onClose={onClose} title={<Text fw={700}>Passwort ändern</Text>} size="sm">
      <form onSubmit={submit}>
        <Stack gap="sm">
          <PasswordInput
            label="Aktuelles Passwort"
            value={current}
            onChange={(e) => setCurrent(e.currentTarget.value)}
            required
            autoComplete="current-password"
          />
          <PasswordInput
            label="Neues Passwort"
            description="Mindestens 8 Zeichen"
            value={next}
            onChange={(e) => setNext(e.currentTarget.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit">Speichern</Button>
          </Group>
        </Stack>
      </form>
    </Sheet>
  )
}
