/**
 * План блока C в терминале TDS: комнаты, коридор, камеры и радар.
 *
 * Планировка повторяет маршрут героини: стартовая комната слева снизу, из
 * неё проём в центральный коридор; коридор ведёт на север к кухне, а из
 * кухни выходной коридор уходит наружу за пределы здания. Справа — щитовая
 * и пост охраны: двери в них закрыты (лист в проёме, прохода нет). У
 * стартовой комнаты двери нет — просто открытый проём. Узел 02 в щитовой
 * мёртв давно; узлы 01 и 05 после выпуска героини выглядят рабочими, но без
 * питания попытка входа кончается ошибкой и адресом щита.
 */
import { fill, panel, setFont } from '../draw'
import type { Rect } from '../draw'
import { getCctv } from '../../cctv'
import { KITCHEN } from '../../cctv-kitchen'
import { POST } from '../../cctv-post'

export type Cam = {
  id: string
  name: string
  online: boolean
  /** Позиция узла на плане: доли внутренней рамки здания. */
  fx: number
  fy: number
}

export const CAMS: Cam[] = [
  { id: '01', name: 'ПОСТ ОХРАНЫ', online: false, fx: 0.77, fy: 0.69 },
  { id: '02', name: 'ЩИТОВАЯ', online: false, fx: 0.77, fy: 0.25 },
  { id: '04', name: 'КОМНАТА 4', online: true, fx: 0, fy: 0 },
  { id: '05', name: 'КУХНЯ', online: false, fx: 0.23, fy: 0.19 },
]

/** Доли комнат внутри рамки здания (по эскизу планировки). */
const CORRIDOR_R = { x0: 0.36, y0: 0.16, x1: 0.62, y1: 0.94 }
const ROOM5 = { x0: 0.1, y0: 0.03, x1: 0.36, y1: 0.36 }
const EXIT_R = { x0: 0.16, y0: -0.05, x1: 0.3, y1: 0.03 }
const SHIELD_R = { x0: 0.62, y0: 0.1, x1: 0.92, y1: 0.4 }
const POST_R = { x0: 0.62, y0: 0.52, x1: 0.92, y1: 0.86 }
const ROOM4 = { x0: 0.06, y0: 0.52, x1: 0.36, y1: 0.94 }

/** Мировые границы пола комнаты 4. */
const WORLD = { x0: -3, x1: 3, z0: -3, z1: 2 }

const WALL = '#7e9a84'
const DOOR = '#a08c5c'
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
    // в кухне её показывает КАМ-05: метка живёт, пока камера 05 смотрит
    const inKitchen = pos !== null && pos.z < KITCHEN.z1
    if (pos && (cctv.sees(pos.x, pos.z) || (inKitchen && cctv.viewNow === '05'))) {
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

  /**
   * Как узел выглядит на плане: online — рабочий; power — ждёт питания
   * (пока героиня привязана); dead — связи нет и не будет.
   */
  status(cam: Cam): 'online' | 'power' | 'dead' {
    const cctv = getCctv()
    if (cam.id === '02') return 'dead'
    if (cam.id === '01') {
      if (cctv.powerReady) return 'online'
      return cctv.girlFreed ? 'online' : 'power'
    }
    if (cam.id === '05') {
      if (cctv.powerReady) return 'online'
      return cctv.girlFreed ? 'online' : 'dead'
    }
    return cam.online ? 'online' : 'dead'
  }

  /** Узел в сети. Для 01 и 05 после выпуска это только видимость. */
  isOnline(cam: Cam): boolean {
    return this.status(cam) === 'online'
  }

  /** Камера выглядит рабочей, но подключение кончится ошибкой питания. */
  needsPower(cam: Cam): boolean {
    return !getCctv().powerReady && (cam.id === '01' || cam.id === '05')
  }

  draw(ctx: CanvasRenderingContext2D, area: Rect, hold: HoldState | null, message: string | null): void {
    this.hits = []
    fill(ctx, area, '#0b0f0c')

    const b: Rect = { x: area.x + 18, y: area.y + 26, w: area.w - 36, h: area.h - 68 }
    this.drawGrid(ctx, b)

    const rect = (r: { x0: number; y0: number; x1: number; y1: number }): Rect => ({
      x: b.x + r.x0 * b.w,
      y: b.y + r.y0 * b.h,
      w: (r.x1 - r.x0) * b.w,
      h: (r.y1 - r.y0) * b.h,
    })
    const post = rect(POST_R)
    const shield = rect(SHIELD_R)
    const room4 = rect(ROOM4)
    const room5 = rect(ROOM5)
    const exit = rect(EXIT_R)

    // ── комнаты: выходная полоса торчит за северную стену ───────────
    this.room(ctx, b, 'ВЫХОД', EXIT_R, '#0e130e')
    this.room(ctx, b, 'КОМНАТА 5 · КУХНЯ', ROOM5, '#131a14')
    this.room(ctx, b, 'КОРИДОР', CORRIDOR_R, '#101610')
    this.room(ctx, b, 'ЩИТОВАЯ', SHIELD_R, '#101510')
    this.room(ctx, b, 'ПОСТ ОХРАНЫ', POST_R, '#121812')
    this.room(ctx, b, 'КОМНАТА 4', ROOM4, '#18211a')

    // улица сверху: за проёмом выхода
    setFont(ctx, 9)
    ctx.fillStyle = 'rgba(126, 154, 132, 0.55)'
    ctx.textAlign = 'center'
    ctx.fillText('У Л И Ц А', b.x + b.w / 2, b.y - 14)
    ctx.textAlign = 'left'

    // проём в северной стене здания в полосе выхода
    fill(ctx, { x: exit.x + 2, y: b.y - 2, w: exit.w - 4, h: 4 }, INK)

    // ── проёмы и двери ──────────────────────────────────────────────
    // кухня: открытый проём в коридор (восточная стена)
    this.gapV(ctx, room5.x + room5.w, room5.y + room5.h * 0.5, room5.h * 0.34)
    // выходная дверь кухни: проём в северной стене
    this.gapH(ctx, room5.x + room5.w * 0.28, room5.y, room5.w * 0.44)
    // стартовая комната: дверь отсутствует — просто открытый проём
    this.gapV(ctx, room4.x + room4.w, room4.y + room4.h * 0.3, room4.h * 0.32)
    // щитовая и пост: двери есть, но закрыты — лист в проёме, прохода нет
    this.gapV(ctx, shield.x, shield.y + shield.h * 0.38, shield.h * 0.34)
    this.closedDoorV(ctx, shield.x, shield.y + shield.h * 0.38, shield.h * 0.34)
    this.gapV(ctx, post.x, post.y + post.h * 0.36, post.h * 0.32)
    this.closedDoorV(ctx, post.x, post.y + post.h * 0.36, post.h * 0.32)

    // стул в стартовой комнате
    const chair = this.worldToMap(-0.6, -0.9, room4, WORLD, { w: 6, h: 5 })
    ctx.strokeStyle = '#a08c5c'
    ctx.strokeRect(chair.x - 4, chair.y - 4, 8, 8)

    const cctv = getCctv()

    // ── секторы камер: жёстко обрезаны по своей комнате ─────────────
    this.sector(ctx, cctv.cam.pos, cctv.cam.at, cctv.cam.fov, room4, room4, { w: 6, h: 5 }, WORLD, 0.85)
    if (cctv.kitchenReady) {
      this.sector(
        ctx,
        cctv.cam05.pos,
        cctv.cam05.at,
        cctv.cam05.fov,
        room5,
        room5,
        { w: KITCHEN.x1 - KITCHEN.x0, h: 3.6 },
        { x0: KITCHEN.x0, x1: KITCHEN.x1, z0: -12.8, z1: -9.2 },
        1.0,
      )
    }
    if (cctv.powerReady) {
      this.sector(
        ctx,
        cctv.cam01.pos,
        cctv.cam01.at,
        cctv.cam01.fov,
        post,
        post,
        { w: POST.x1 - POST.x0, h: POST.z1 - POST.z0 },
        { x0: POST.x0, x1: POST.x1, z0: POST.z0, z1: POST.z1 },
        1.15,
      )
    }

    if (this.lastSeen && this.alpha > 0) {
      // метка ложится в ту комнату, где её видели
      const gp =
        this.lastSeen.z < KITCHEN.z1
          ? this.worldToMap(
              this.lastSeen.x,
              this.lastSeen.z,
              room5,
              { x0: KITCHEN.x0, x1: KITCHEN.x1, z0: -12.8, z1: -9.2 },
              { w: KITCHEN.x1 - KITCHEN.x0, h: 3.6 },
            )
          : this.worldToMap(this.lastSeen.x, this.lastSeen.z, room4, WORLD, { w: 6, h: 5 })
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
        const cp = this.worldToMap(cctv.cam.pos[0], cctv.cam.pos[2], room4, WORLD, { w: 6, h: 5 })
        cx = cp.x
        cy = cp.y
      } else if (cam.id === '05' && cctv.kitchenReady) {
        const c5 = cctv.cam05
        const p5 = this.worldToMap(
          c5.pos[0],
          c5.pos[2],
          room5,
          { x0: KITCHEN.x0, x1: KITCHEN.x1, z0: -12.8, z1: -9.2 },
          { w: KITCHEN.x1 - KITCHEN.x0, h: 3.6 },
        )
        cx = p5.x
        cy = p5.y
      } else {
        cx = b.x + cam.fx * b.w
        cy = b.y + cam.fy * b.h
      }
      this.node(ctx, cam, cx, cy, hold?.id === cam.id ? hold.p : 0)
    }

    // ── подвал ──────────────────────────────────────────────────────
    const footY = area.y + area.h - 18
    setFont(ctx, 10)
    const inNet = CAMS.filter((c) => this.isOnline(c)).length
    ctx.fillStyle = '#7e8c80'
    ctx.fillText(`БЛОК C · В СЕТИ ${inNet} ИЗ ${CAMS.length}`, area.x + 18, footY)
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
    r: { x0: number; y0: number; x1: number; y1: number },
    color: string,
  ): void {
    const rect: Rect = {
      x: b.x + r.x0 * b.w,
      y: b.y + r.y0 * b.h,
      w: (r.x1 - r.x0) * b.w,
      h: (r.y1 - r.y0) * b.h,
    }
    fill(ctx, rect, color)
    ctx.strokeStyle = WALL
    ctx.lineWidth = 2
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2)
    if (label) {
      setFont(ctx, 9)
      ctx.fillStyle = 'rgba(140, 170, 146, 0.7)'
      ctx.textAlign = 'center'
      ctx.fillText(label, rect.x + rect.w / 2, rect.y + Math.min(16, rect.h - 6))
      ctx.textAlign = 'left'
    }
    ctx.lineWidth = 1
  }

  /** Проём в вертикальной стене: разрыв, читается как открытая дверь. */
  private gapV(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
    fill(ctx, { x: x - 2, y, w: 4, h }, INK)
  }

  /** Проём в горизонтальной стене. */
  private gapH(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
    fill(ctx, { x, y: y - 2, w, h: 4 }, INK)
  }

  /** Закрытая дверь: лист в проёме — дверь есть, прохода нет. */
  private closedDoorV(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
    fill(ctx, { x: x - 1, y: y + 1, w: 2, h: h - 2 }, DOOR)
  }

  /**
   * Сектор обзора камеры: конус от позиции к цели, обрезанный по плану
   * комнаты — угол обзора не должен выходить за стены.
   */
  private sector(
    ctx: CanvasRenderingContext2D,
    pos: readonly number[],
    at: readonly number[],
    fov: number,
    drawRect: Rect,
    clipRect: Rect,
    scale: { w: number; h: number },
    world: { x0: number; x1: number; z0: number; z1: number },
    lenK: number,
  ): void {
    const toMap = (wx: number, wz: number): { x: number; y: number } =>
      this.worldToMap(wx, wz, drawRect, world, scale)
    const cp = toMap(pos[0], pos[2])
    const ca = toMap(at[0], at[2])
    const ang = Math.atan2(ca.y - cp.y, ca.x - cp.x)
    const half = ((fov / 2) * Math.PI) / 180
    const len = Math.max(46, (drawRect.w + drawRect.h) * 0.5 * lenK)
    ctx.save()
    ctx.beginPath()
    ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h)
    ctx.clip()
    ctx.fillStyle = 'rgba(140, 220, 150, 0.12)'
    ctx.beginPath()
    ctx.moveTo(cp.x, cp.y)
    ctx.lineTo(cp.x + Math.cos(ang - half) * len, cp.y + Math.sin(ang - half) * len)
    ctx.lineTo(cp.x + Math.cos(ang) * len, cp.y + Math.sin(ang) * len)
    ctx.lineTo(cp.x + Math.cos(ang + half) * len, cp.y + Math.sin(ang + half) * len)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  private node(ctx: CanvasRenderingContext2D, cam: Cam, cx: number, cy: number, p: number): void {
    const r: Rect = { x: cx - 15, y: cy - 11, w: 30, h: 22 }
    if (this.isOnline(cam)) {
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
    const st = this.status(cam)
    ctx.fillStyle = st === 'online' ? '#a9c9ae' : st === 'power' ? '#8a7f5c' : '#6f7d72'
    ctx.textAlign = 'center'
    ctx.fillText(cam.name, cx, r.y + r.h + 10)
    ctx.fillStyle = st === 'online' ? '#2c7a2c' : st === 'power' ? '#b39a4c' : '#6b5a3a'
    ctx.fillText(
      st === 'online' ? 'В СЕТИ' : st === 'power' ? 'НЕТ ПИТАНИЯ' : 'НЕТ СВЯЗИ',
      cx,
      r.y + r.h + 21,
    )

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

  /** Мировые координаты комнаты → пиксели плана. */
  private worldToMap(
    x: number,
    z: number,
    room: Rect,
    world: { x0: number; x1: number; z0: number; z1: number },
    scale: { w: number; h: number },
  ): { x: number; y: number } {
    return {
      x: room.x + ((x - world.x0) / scale.w) * room.w,
      y: room.y + ((z - world.z0) / scale.h) * room.h,
    }
  }
}
