/**
 * План блока C в терминале TDS: комнаты, коридор, камеры и радар.
 *
 * Пока объект в секторе камеры 04 — красная метка горит, после потери она
 * медленно гаснет на последнем замеченном месте. Узлы 01–03 нарисованы для
 * антуража: связи с ними нет, войти можно только в камеру 04.
 */
import { fill, panel, setFont } from '../draw'
import type { Rect } from '../draw'
import { getCctv } from '../../cctv'

export type Cam = {
  id: string
  name: string
  online: boolean
  /** Позиция узла на плане: доли внутренней рамки здания. */
  fx: number
  fy: number
}

export const CAMS: Cam[] = [
  { id: '01', name: 'ХОЛЛ', online: false, fx: 0.14, fy: 0.6 },
  { id: '02', name: 'КОРИДОР', online: false, fx: 0.44, fy: 0.19 },
  { id: '03', name: 'ЛЕСТНИЦА', online: false, fx: 0.91, fy: 0.43 },
  { id: '04', name: 'КОМНАТА 4', online: true, fx: 0, fy: 0 },
]

/** Доли комнаты 4 внутри здания; по ним мир камеры ложится на план. */
const ROOM4 = { fx: 0.3, fy: 0.3, fw: 0.28, fh: 0.48 }

/** Мировые границы пола комнаты 4. */
const WORLD = { x0: -3, x1: 3, z0: -3, z1: 2 }

const WALL = '#7e9a84'
const INK = '#0b0f0c'

export type HoldState = { id: string; p: number }

export class TdsMap {
  /** Яркость метки объекта: 1 — в кадре, плавно гаснет после потери. */
  private alpha = 0
  private lastSeen: { x: number; z: number } | null = null
  private hits: Array<{ cam: Cam; r: Rect }> = []

  tick(): boolean {
    const cctv = getCctv()
    if (!cctv.loaded || cctv.gone) {
      if (this.alpha > 0) {
        this.alpha = 0
        return true
      }
      return false
    }
    const pos = cctv.girlPos
    if (pos && cctv.sees(pos.x, pos.z)) {
      this.lastSeen = pos
      if (this.alpha < 1) this.alpha = Math.min(1, this.alpha + 0.25)
      return true
    }
    if (this.alpha > 0) {
      this.alpha = Math.max(0, this.alpha - 0.006)
      return true
    }
    return false
  }

  /** Центр узла по id — для инструментов проверки (координаты после отрисовки). */
  point(id: string): { x: number; y: number } | null {
    const h = this.hits.find((v) => v.cam.id === id)
    return h ? { x: h.r.x + h.r.w / 2, y: h.r.y + h.r.h / 2 } : null
  }

  /** Узел камеры под точкой; координаты — абсолютные, как у клика. */
  hit(x: number, y: number): Cam | null {
    for (const h of this.hits) {
      if (x >= h.r.x && y >= h.r.y && x < h.r.x + h.r.w && y < h.r.y + h.r.h) return h.cam
    }
    return null
  }

  draw(ctx: CanvasRenderingContext2D, area: Rect, hold: HoldState | null, message: string | null): void {
    this.hits = []
    fill(ctx, area, '#0b0f0c')

    const b: Rect = { x: area.x + 18, y: area.y + 14, w: area.w - 36, h: area.h - 56 }
    this.drawGrid(ctx, b)

    const room4 = {
      x: b.x + ROOM4.fx * b.w,
      y: b.y + ROOM4.fy * b.h,
      w: ROOM4.fw * b.w,
      h: ROOM4.fh * b.h,
    }

    // ── комнаты ─────────────────────────────────────────────────────
    this.room(ctx, b, 'КОРИДОР', 0, 0.08, 1, 0.3, '#101610')
    this.room(ctx, b, 'ХОЛЛ', 0, 0.3, 0.3, 0.86, '#131a14')
    this.room(ctx, b, 'КОМНАТА 4', ROOM4.fx, ROOM4.fy, ROOM4.fx + ROOM4.fw, ROOM4.fy + ROOM4.fh, '#18211a')
    this.room(ctx, b, 'КОМНАТА 5', 0.58, 0.3, 0.82, 0.56, '#131a14')
    this.room(ctx, b, 'ЛЕСТНИЦА', 0.82, 0.3, 1, 0.56, '#111711')
    this.room(ctx, b, 'СКЛАД', 0.3, 0.78, 0.82, 1, '#121812')
    this.room(ctx, b, 'ЩИТОВАЯ', 0.82, 0.56, 1, 1, '#101510')

    // ступени
    ctx.strokeStyle = 'rgba(126, 154, 132, 0.45)'
    ctx.lineWidth = 1
    for (let i = 1; i <= 4; i++) {
      const y = b.y + 0.3 * b.h + ((0.26 * b.h) / 5) * i
      ctx.beginPath()
      ctx.moveTo(b.x + 0.84 * b.w, y)
      ctx.lineTo(b.x + 0.98 * b.w, y)
      ctx.stroke()
    }

    // дверь комнаты 4: проём в стене коридора и дуга открывания
    const doorL = room4.x + ((-0.6 - WORLD.x0) / (WORLD.x1 - WORLD.x0)) * room4.w
    const doorR = room4.x + ((0.6 - WORLD.x0) / (WORLD.x1 - WORLD.x0)) * room4.w
    fill(ctx, { x: doorL, y: room4.y - 2, w: doorR - doorL, h: 4 }, INK)
    ctx.strokeStyle = '#c9c2a0'
    ctx.beginPath()
    ctx.arc(doorL, room4.y, doorR - doorL, 0, Math.PI / 2)
    ctx.stroke()

    // стул
    const chair = this.worldToMap(-0.6, -0.9, room4)
    ctx.strokeStyle = '#a08c5c'
    ctx.strokeRect(chair.x - 4, chair.y - 4, 8, 8)

    // ── сектор камеры 04 и радар ────────────────────────────────────
    const cctv = getCctv()
    const v = cctv.cam
    const cp = this.worldToMap(v.pos[0], v.pos[2], room4)
    const ca = this.worldToMap(v.at[0], v.at[2], room4)
    const ang = Math.atan2(ca.y - cp.y, ca.x - cp.x)
    const half = ((v.fov / 2) * Math.PI) / 180
    const len = Math.max(60, room4.w * 0.9)
    ctx.fillStyle = 'rgba(140, 220, 150, 0.12)'
    ctx.beginPath()
    ctx.moveTo(cp.x, cp.y)
    ctx.lineTo(cp.x + Math.cos(ang - half) * len, cp.y + Math.sin(ang - half) * len)
    ctx.lineTo(cp.x + Math.cos(ang) * len, cp.y + Math.sin(ang) * len)
    ctx.lineTo(cp.x + Math.cos(ang + half) * len, cp.y + Math.sin(ang + half) * len)
    ctx.closePath()
    ctx.fill()

    if (this.lastSeen && this.alpha > 0) {
      const gp = this.worldToMap(this.lastSeen.x, this.lastSeen.z, room4)
      ctx.globalAlpha = this.alpha
      ctx.fillStyle = '#d4402e'
      ctx.beginPath()
      ctx.arc(gp.x, gp.y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#f2a08e'
      ctx.stroke()
      setFont(ctx, 9)
      ctx.fillStyle = '#f2b0a0'
      ctx.textAlign = 'center'
      ctx.fillText('ОБЪЕКТ', gp.x, gp.y - 10)
      ctx.textAlign = 'left'
      ctx.globalAlpha = 1
    }

    // ── узлы камер ──────────────────────────────────────────────────
    for (const cam of CAMS) {
      let cx: number
      let cy: number
      if (cam.id === '04') {
        cx = cp.x
        cy = cp.y
      } else {
        cx = b.x + cam.fx * b.w
        cy = b.y + cam.fy * b.h
      }
      this.node(ctx, cam, cx, cy, hold?.id === cam.id ? hold.p : 0)
    }

    // ── подвал ──────────────────────────────────────────────────────
    const footY = area.y + area.h - 18
    setFont(ctx, 10)
    ctx.fillStyle = '#7e8c80'
    ctx.fillText('БЛОК C · В СЕТИ 1 ИЗ 4', area.x + 18, footY)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#5f6f62'
    ctx.fillText('TDS 2.1 · УЗЕЛ INTRANET-LOCAL', area.x + area.w - 18, footY)
    ctx.textAlign = 'center'
    if (message) {
      ctx.fillStyle = '#d8b25a'
      ctx.fillText(message, area.x + area.w / 2, footY)
    } else {
      ctx.fillStyle = '#9fd39f'
      ctx.fillText('ЗАЖМИТЕ КАМЕРУ НА 2 СЕКУНДЫ, ЧТОБЫ ВОЙТИ', area.x + area.w / 2, footY)
    }
    ctx.textAlign = 'left'
  }

  private drawGrid(ctx: CanvasRenderingContext2D, b: Rect): void {
    ctx.save()
    ctx.beginPath()
    ctx.rect(b.x, b.y, b.w, b.h)
    ctx.clip()
    ctx.strokeStyle = 'rgba(90, 120, 95, 0.12)'
    ctx.lineWidth = 1
    for (let gx = b.x; gx < b.x + b.w; gx += 16) {
      ctx.beginPath()
      ctx.moveTo(gx + 0.5, b.y)
      ctx.lineTo(gx + 0.5, b.y + b.h)
      ctx.stroke()
    }
    for (let gy = b.y; gy < b.y + b.h; gy += 16) {
      ctx.beginPath()
      ctx.moveTo(b.x, gy + 0.5)
      ctx.lineTo(b.x + b.w, gy + 0.5)
      ctx.stroke()
    }
    ctx.restore()
  }

  /** Комната как прямоугольник с подписью; границы — доли рамки здания. */
  private room(
    ctx: CanvasRenderingContext2D,
    b: Rect,
    label: string,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
  ): void {
    const r: Rect = {
      x: b.x + x0 * b.w,
      y: b.y + y0 * b.h,
      w: (x1 - x0) * b.w,
      h: (y1 - y0) * b.h,
    }
    fill(ctx, r, color)
    ctx.strokeStyle = WALL
    ctx.lineWidth = 2
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2)
    setFont(ctx, 9)
    ctx.fillStyle = 'rgba(140, 170, 146, 0.7)'
    ctx.textAlign = 'center'
    ctx.fillText(label, r.x + r.w / 2, r.y + Math.min(16, r.h - 6))
    ctx.textAlign = 'left'
    ctx.lineWidth = 1
  }

  private node(ctx: CanvasRenderingContext2D, cam: Cam, cx: number, cy: number, p: number): void {
    const r: Rect = { x: cx - 15, y: cy - 11, w: 30, h: 22 }
    if (cam.online) {
      panel(ctx, r, true, 1)
      setFont(ctx, 10, true)
      ctx.fillStyle = '#1d3a1d'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(cam.id, cx, cy + 1)
      ctx.textAlign = 'left'
      // живой канал мигает красным
      if (Math.floor(performance.now() / 500) % 2 === 0) {
        ctx.fillStyle = '#d4402e'
        ctx.beginPath()
        ctx.arc(r.x + r.w - 3, r.y + 3, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
    } else {
      ctx.fillStyle = '#242a25'
      ctx.strokeStyle = '#5c6a5f'
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
      setFont(ctx, 10, true)
      ctx.fillStyle = '#7d8a7f'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(cam.id, cx, cy + 1)
      ctx.textAlign = 'left'
    }

    setFont(ctx, 9)
    ctx.fillStyle = cam.online ? '#a9c9ae' : '#6f7d72'
    ctx.textAlign = 'center'
    ctx.fillText(cam.name, cx, r.y + r.h + 10)
    ctx.fillStyle = cam.online ? '#2c7a2c' : '#6b5a3a'
    ctx.fillText(cam.online ? 'В СЕТИ' : 'НЕТ СВЯЗИ', cx, r.y + r.h + 21)

    // удержание: кольцо заполняется по кругу
    if (p > 0) {
      ctx.strokeStyle = 'rgba(159, 211, 159, 0.25)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(cx, cy, 24, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = '#9fd39f'
      ctx.beginPath()
      ctx.arc(cx, cy, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p))
      ctx.stroke()
      ctx.lineWidth = 1
      setFont(ctx, 10, true)
      ctx.fillStyle = '#d8f0d8'
      ctx.fillText(`${Math.round(Math.min(1, p) * 100)}%`, cx, cy - 31)
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    this.hits.push({ cam, r })
  }

  /** Мировые координаты комнаты 4 → пиксели плана. */
  private worldToMap(x: number, z: number, room: Rect): { x: number; y: number } {
    return {
      x: room.x + ((x - WORLD.x0) / (WORLD.x1 - WORLD.x0)) * room.w,
      y: room.y + ((z - WORLD.z0) / (WORLD.z1 - WORLD.z0)) * room.h,
    }
  }
}
