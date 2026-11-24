import { useEffect, useRef } from 'react'

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
  label: string
}

/** A pad to draw on with a finger or a pen: the drawings of a visit and the signature of the customer. */
export function DrawPad({ value, onChange, width, height, color = '#14232a', erase = false, lineWidth = 3, grid = false, label }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const drawn = useRef(false)

  // What was drawn before: drawn once when the pad opens (another sheet opens a pad of its own).
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx || !value) return
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height)
      drawn.current = true
    }
    img.src = value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [((event.clientX - rect.left) / rect.width) * width, ((event.clientY - rect.top) / rect.height) * height] as const
  }

  return (
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
        drawn.current = true
        onChange(event.currentTarget.toDataURL('image/png'))
      }}
      onPointerCancel={() => {
        drawing.current = false
      }}
    />
  )
}

/** Wipes a pad: what it showed is gone, and it tells so. */
export function clearPad(pad: HTMLCanvasElement | null) {
  pad?.getContext('2d')?.clearRect(0, 0, pad.width, pad.height)
}
