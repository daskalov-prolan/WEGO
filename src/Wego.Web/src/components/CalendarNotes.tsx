import { Button, Group, HoverCard, Modal, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useState, type MouseEvent } from 'react'
import { api, messageOf } from '../api/client'
import type { CalendarNote } from '../api/types'
import { formatDateLong } from '../lib/dates'

/**
 * The notes in a field of the plan: the short title, the explanation when pointing at it (or tapping it).
 * `onMenu`: planners, a right click on a note (change or delete it); `onOpen`: a click on it (planners change
 * it, the others read it, also where pointing at it is not possible, on a phone).
 */
export function CellNotes({
  notes,
  onMenu,
  onOpen,
}: {
  notes: CalendarNote[]
  onMenu?: (note: CalendarNote, event: MouseEvent) => void
  onOpen?: (note: CalendarNote) => void
}) {
  // A finger opens the note itself; the card for pointing at it would only get in the way.
  const touch = useMediaQuery('(pointer: coarse)')
  return (
    <span className="cell-notes">
      {notes.map((note) => (
        <HoverCard key={note.id} disabled={touch && !!onOpen} width={260} shadow="md" openDelay={150} position="bottom" withArrow withinPortal>
          <HoverCard.Target>
            <span
              className="cell-note"
              aria-label={`Notiz: ${note.title}`}
              // Right on the note its card shows it, not the tooltip of the field as well.
              title=""
              data-clickable={onOpen ? true : undefined}
              onClick={
                onOpen
                  ? (event) => {
                      // The note opens, not the day of the field.
                      event.stopPropagation()
                      onOpen(note)
                    }
                  : undefined
              }
              onContextMenu={
                onMenu
                  ? (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onMenu(note, event)
                    }
                  : undefined
              }
            >
              {note.title}
            </span>
          </HoverCard.Target>
          <HoverCard.Dropdown>
            <Text size="xs" c="dimmed">
              {formatDateLong(note.date)}
            </Text>
            <Text fw={700} size="sm">
              {note.title}
            </Text>
            {note.text && (
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }} mt={4}>
                {note.text}
              </Text>
            )}
          </HoverCard.Dropdown>
        </HoverCard>
      ))}
    </span>
  )
}

/** Writes a new note in the field of an employee and a day (without `note`), or changes or deletes one. */
export function NoteDialog({
  employee,
  date,
  note,
  onSaved,
  onDeleted,
  onClose,
}: {
  employee: { id: number; name: string }
  date: string
  note?: CalendarNote
  onSaved: (note: CalendarNote) => void
  onDeleted: (id: number) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [text, setText] = useState(note?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
      onClose()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      const input = { employeeId: employee.id, date: note?.date ?? date, title, text }
      onSaved(note ? await api.updateNote(note.id, input) : await api.createNote(input))
    })

  return (
    <Modal opened onClose={onClose} title={`Notiz · ${employee.name} · ${formatDateLong(note?.date ?? date)}`} centered>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Stack gap="sm">
          <TextInput
            label="Überschrift"
            description="Steht kurz im Feld des Kalenders."
            maxLength={40}
            required
            data-autofocus
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <Textarea
            label="Erklärung"
            description="Erscheint, wenn man auf die Notiz zeigt."
            maxLength={1000}
            autosize
            minRows={3}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
          />
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Group justify="space-between">
            {note ? (
              <Button
                variant="subtle"
                color="red"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.deleteNote(note.id)
                    onDeleted(note.id)
                  })
                }
              >
                Löschen
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" loading={busy} disabled={!title.trim()}>
              Speichern
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

/** A note opened by those who may not change it: its title and explanation, to read. */
export function NoteView({ note, employeeName, onClose }: { note: CalendarNote; employeeName: string; onClose: () => void }) {
  return (
    <Modal opened onClose={onClose} title={`Notiz · ${employeeName} · ${formatDateLong(note.date)}`} centered>
      <Stack gap="sm">
        <Text fw={700}>{note.title}</Text>
        {note.text ? (
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {note.text}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            Keine Erklärung.
          </Text>
        )}
        <Group justify="flex-end">
          <Button onClick={onClose}>Schließen</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
