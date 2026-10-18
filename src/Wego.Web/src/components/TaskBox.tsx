import { Alert, Button, Group, MultiSelect, Popover, Stack, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useState, type CSSProperties } from 'react'
import { messageOf } from '../api/client'
import type { PlanEmployee } from '../api/types'
import { ACTIVITIES } from '../lib/activities'
import { dragSource } from '../lib/dragPlan'
import { ActivityIcon } from './ActivityIcon'
import type { OpenTask } from './PlanMatrix'

interface Props {
  task: OpenTask
  /** Text of the box; the activity by default, the site in the plan by employee. */
  label?: string
  /** Who can do this activity; offered for planning it. */
  employees: PlanEmployee[]
  /** Plan by employee: the box belongs to this employee, only the day is asked for. */
  employee?: PlanEmployee
  /** The day offered first, e.g. the first day in view. */
  defaultDate: string
  minDate: string
  maxDate: string
  /** Planners only: puts the activity on these employees on that day. */
  onPlan?: (employeeIds: number[], date: string) => Promise<void>
  /** Planners: the activity is not relevant for this site; it is then only listed on the site's page. */
  onCancel?: () => Promise<void>
  /** The site of the activity: planners can drag the box onto a day of the plan. */
  siteId?: number
}

/** An activity of a site that is not planned yet: a box in its colour; planners plan it from here. */
export function TaskBox(props: Props) {
  const { task, label, employees, employee, defaultDate, minDate, maxDate, onPlan, onCancel, siteId } = props
  const info = ACTIVITIES.find((activity) => activity.value === task.activity)!
  const [opened, setOpened] = useState(false)
  const [chosen, setChosen] = useState<string[]>(employee ? [String(employee.id)] : [])
  const [date, setDate] = useState<string | null>(defaultDate)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      setOpened(false)
      setChosen(employee ? [String(employee.id)] : [])
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const box = (
    <button
      type="button"
      className={onPlan && siteId !== undefined ? 'task-box drag-source' : 'task-box'}
      {...dragSource({ kind: 'task', siteId: siteId ?? 0, activity: task.activity }, onPlan !== undefined && siteId !== undefined)}
      style={{ '--entry-bg': info.tint, '--entry-strong': info.background } as CSSProperties}
      title={`${label ? `${label} – ` : ''}${info.label}: noch nicht eingeplant`}
      onClick={() => {
        if (!onPlan) return
        setDate(defaultDate)
        setOpened((open) => !open)
      }}
      disabled={!onPlan}
    >
      <ActivityIcon activity={task.activity} />
      <span className="task-name">{label ?? info.label}</span>
    </button>
  )

  if (!onPlan) return box

  return (
    <Popover opened={opened} onChange={setOpened} position="right-start" withArrow shadow="md" withinPortal trapFocus>
      <Popover.Target>{box}</Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" w={260}>
          <Text fw={700} size="sm">
            {info.label} einplanen
          </Text>
          {(label || employee) && (
            <Text size="xs" c="dimmed" mt={-6}>
              {[label, employee?.name].filter(Boolean).join(' · ')}
            </Text>
          )}
          {employee ? (
            <DateInput
              label="Tag"
              valueFormat="DD.MM.YYYY"
              value={date}
              onChange={setDate}
              minDate={minDate}
              maxDate={maxDate}
              popoverProps={{ withinPortal: false }}
            />
          ) : employees.length === 0 ? (
            <Text size="sm" c="dimmed">
              Niemand hat diese Tätigkeit. Bitte in der Verwaltung beim Mitarbeiter zuordnen.
            </Text>
          ) : (
            <>
              <MultiSelect
                label="Mitarbeiter"
                placeholder={chosen.length ? undefined : 'wer?'}
                data={employees.map((employee) => ({ value: String(employee.id), label: employee.name }))}
                value={chosen}
                onChange={setChosen}
                searchable
                comboboxProps={{ withinPortal: false }}
              />
              <DateInput
                label="Tag"
                valueFormat="DD.MM.YYYY"
                value={date}
                onChange={setDate}
                minDate={minDate}
                maxDate={maxDate}
                popoverProps={{ withinPortal: false }}
              />
            </>
          )}
          {error && (
            <Alert color="red" variant="light" p="xs">
              {error}
            </Alert>
          )}
          <Group justify="space-between">
            {onCancel ? (
              <Button
                size="compact-sm"
                variant="subtle"
                color="red"
                disabled={busy}
                title="Für diese Baustelle nicht relevant: wird nur noch auf der Seite der Baustelle als storniert gezeigt."
                onClick={() => run(onCancel)}
              >
                Stornieren
              </Button>
            ) : (
              <span />
            )}
            <Button
              size="compact-sm"
              loading={busy}
              disabled={chosen.length === 0 || !date}
              onClick={() => run(() => onPlan(chosen.map(Number), date!))}
            >
              Einplanen
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
