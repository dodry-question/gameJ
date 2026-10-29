/**
 * Рисовалка интерфейса в стиле Windows 2000, но грязного и выцветшего.
 * Всё рисуется вручную на canvas 2D: никаких картинок, только фаски и текст.
 */

export type Rect = { x: number; y: number; w: number; h: number }

export const FONT = 'Tahoma, "MS Sans Serif", Verdana, sans-serif'

export const C = {
  face: '#bdbdb5',
  faceHi: '#dcdcd4',
  faceLo: '#8e8e86',
  hi: '#f2f2ea',
  lo: '#4a4a44',
  text: '#16160f',
  textDim: '#5c5c54',
  desk: '#0d3331',
  deskDark: '#082524',
  deskText: '#d7e2df',
  titleOn: '#12294f',
  titleOn2: '#2c4f86',
  titleOff: '#6d6d66',
  titleText: '#eef1f4',
  paper: '#e6e4d8',
  ink: '#23231c',
  link: '#12127a',
  linkSeen: '#5a1a5a',
  select: '#1b3a6b',
  alert: '#7a1414',
} as const

export function setFont(ctx: CanvasRenderingContext2D, size = 12, bold = false): void {
  // 1.12 — компенсация того, что экран в 3D чуть меньше текстуры
  const px = Math.round(size * 1.12)
  ctx.font = `${bold ? 'bold ' : ''}${px}px ${FONT}`
}

export function fill(ctx: CanvasRenderingContext2D, r: Rect, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(r.x, r.y, r.w, r.h)
}

function quad(ctx: CanvasRenderingContext2D, color: string, pts: number[][]): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
  ctx.fill()
}

/** Фаска: светлое сверху-слева, тёмное снизу-справа (или наоборот, если вдавлено). */
export function bevel(ctx: CanvasRenderingContext2D, r: Rect, raised = true, t = 2): void {
  const a = raised ? C.hi : C.lo
  const b = raised ? C.lo : C.hi
  const { x, y, w, h } = r
  quad(ctx, a, [
    [x, y],
    [x + w, y],
    [x + w - t, y + t],
    [x + t, y + t],
  ])
  quad(ctx, a, [
    [x, y],
    [x + t, y + t],
    [x + t, y + h - t],
    [x, y + h],
  ])
  quad(ctx, b, [
    [x, y + h],
    [x + t, y + h - t],
    [x + w - t, y + h - t],
    [x + w, y + h],
  ])
  quad(ctx, b, [
    [x + w, y],
    [x + w, y + h],
    [x + w - t, y + h - t],
    [x + w - t, y + t],
  ])
}

export function panel(ctx: CanvasRenderingContext2D, r: Rect, raised = true, t = 2): void {
  fill(ctx, r, C.face)
  bevel(ctx, r, raised, t)
}

export function inset(r: Rect, n: number): Rect {
  return { x: r.x + n, y: r.y + n, w: r.w - n * 2, h: r.h - n * 2 }
}

export function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h
}

export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  opts: { size?: number; bold?: boolean; color?: string; align?: CanvasTextAlign } = {},
): void {
  setFont(ctx, opts.size ?? 12, opts.bold)
  ctx.fillStyle = opts.color ?? C.text
  ctx.textAlign = opts.align ?? 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(s, x, y)
  ctx.textAlign = 'left'
}

export function button(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  pressed = false,
  size = 12,
): void {
  panel(ctx, r, !pressed)
  setFont(ctx, size)
  ctx.fillStyle = C.text
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, r.x + r.w / 2 + (pressed ? 1 : 0), r.y + r.h / 2 + (pressed ? 1 : 0))
  ctx.textAlign = 'left'
}

/** Обрезать строку с многоточием, чтобы не налезала на соседнюю колонку. */
export function ellipsis(
  ctx: CanvasRenderingContext2D,
  s: string,
  maxW: number,
  size = 12,
  bold = false,
): string {
  setFont(ctx, size, bold)
  if (ctx.measureText(s).width <= maxW) return s
  let cut = s
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1)
  return `${cut}…`
}

/** Перенос текста по словам, чтобы влезал в width. */
export function wrap(ctx: CanvasRenderingContext2D, s: string, width: number, size = 12): string[] {
  setFont(ctx, size)
  const out: string[] = []
  for (const paragraph of s.split('\n')) {
    if (!paragraph) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width > width && line) {
        out.push(line)
        line = word
      } else {
        line = next
      }
    }
    out.push(line)
  }
  return out
}

export function scaleRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }
}
