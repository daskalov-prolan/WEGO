import { Button, Group, HoverCard, Modal, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useState, type MouseEvent } from 'react'
import { api, messageOf } from '../api/client'
import type { CalendarNote } from '../api/types'
import { formatDateLong } from '../lib/dates'

/**
 * The notes in a field of the plan: the short title, the explanation when pointing at it (or tapping it).
 * `onMenu`: planners, a right click on a note (change or delete it); `onOpen`: planners, a click on it.
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
  return (
    <span className="cell-notes">
      {notes.map((note) => (
        <HoverCard key={note.id} width={260} shadow="md" openDelay={150} position="bottom" withArrow withinPortal>
          <HoverCard.Target>
            <span
              className="cell-note"
              aria-label={`Notiz: ${note.title}`}
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
