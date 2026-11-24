import { Button, Group } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'

interface Props {
  /** What was drawn before (PNG), drawn again when the pad opens. */
  value: string | null
  /** After each stroke: what is drawn now, as PNG (transparent where nothing is). */
  onChange: (png: string | null) => void
  /** Size of the drawing in pixels; the pad shows it as wide as there is room. */
  width: number
  height: number
  color?: string
  /** Wipes out instead of drawing. */
  erase?: boolean
  lineWidth?: number
  /** Squared paper behind it (only shown: the ink stays on its own). */
  grid?: boolean
  /** "Zurück" and "Vor": a stroke taken back, and brought back again. */
  steps?: boolean
  label: string
}

/** Strokes kept to go back to: enough for a drawing, without filling the tablet. */
const MAX_STEPS = 40

/** A pad to draw on with a finger or a pen: the drawings of a visit and the signature of the customer. */
export function DrawPad({ value, onChange, width, height, color = '#14232a', erase = false, lineWidth = 3, grid = false, steps = false, label }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  // What the pad showed after each stroke (null: empty), and where in it the pad stands now.
  const history = useRef<(string | null)[]>([value])
  const [at, setAt] = useState(0)
  const [count, setCount] = useState(1)

  const show = (png: string | null) => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, width, height)
    if (!png) return
    const img = new Image()
    img.onload = () => ctx.drawImage(img, 0, 0, width, height)
    img.src = png
  }

  // What was drawn before: drawn once when the pad opens (another sheet opens a pad of its own).
  useEffect(() => {
    show(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = (to: number) => {
    const png = history.current[to] ?? null
    setAt(to)
    show(png)
    onChange(png)
  }

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [((event.clientX - rect.left) / rect.width) * width, ((event.clientY - rect.top) / rect.height) * height] as const
  }

  const pad = (
    <canvas
      ref={canvas}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className={grid ? 'draw-pad grid' : 'draw-pad'}
      style={{ aspectRatio: `${width} / ${height}` }}
      onPointerDown={(event) => {
        const ctx = event.currentTarget.getContext('2d')
        if (!ctx) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drawing.current = true
        const [x, y] = point(event)
        ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
        ctx.strokeStyle = color
        ctx.lineWidth = erase ? lineWidth * 8 : lineWidth
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(x, y)
        // A tap alone leaves a dot.
        ctx.lineTo(x + 0.1, y + 0.1)
        ctx.stroke()
      }}
      onPointerMove={(event) => {
        if (!drawing.current) return
        const ctx = event.currentTarget.getContext('2d')
        if (!ctx) return
        const [x, y] = point(event)
        ctx.lineTo(x, y)
        ctx.stroke()
      }}
      onPointerUp={(event) => {
        if (!drawing.current) return
        drawing.current = false
        const png = event.currentTarget.toDataURL('image/png')
        // A new stroke after going back: what was taken back is gone.
        const kept = [...history.current.slice(0, at + 1), png].slice(-MAX_STEPS)
        history.current = kept
        setAt(kept.length - 1)
        setCount(kept.length)
        onChange(png)
      }}
      onPointerCancel={() => {
        drawing.current = false
      }}
    />
  )

  if (!steps) return pad
  return (
    <>
      <Group gap={6} mb={6}>
        <Button variant="default" radius="xl" disabled={at === 0} onClick={() => go(at - 1)} aria-label="Zurück: letzten Strich zurücknehmen">
          ↶ Zurück
        </Button>
        <Button variant="default" radius="xl" disabled={at >= count - 1} onClick={() => go(at + 1)} aria-label="Vor: Strich wiederholen">
          ↷ Vor
        </Button>
      </Group>
      {pad}
    </>
  )
}
