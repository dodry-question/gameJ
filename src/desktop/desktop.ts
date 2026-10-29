import { C, bevel, fill, inside, panel, setFont, text } from './draw'
import type { Rect } from './draw'
import type { App } from './app'
import { Browser } from './apps/browser'
import { Mail } from './apps/mail'
import { Note } from './apps/note'
import type { Sound } from '../audio'

export const DESKTOP_W = 960
export const DESKTOP_H = 720

const TASKBAR = 30
const TITLE = 20

type Win = {
  key: string
  app: App
  x: number
  y: number
  w: number
  h: number
  z: number
  min: boolean
  max: boolean
  restore: Rect | null
}

type MenuItem = { label: string; key?: string } | null

const SIZES: Record<string, Rect> = {
  browser: { x: 120, y: 52, w: 640, h: 486 },
  mail: { x: 250, y: 122, w: 620, h: 476 },
  computer: { x: 300, y: 190, w: 350, h: 200 },
  trash: { x: 300, y: 190, w: 350, h: 180 },
}

const ICONS: Array<{ label: string; key: string }> = [
  { label: 'Почта', key: 'mail' },
  { label: 'Интернет', key: 'browser' },
  { label: 'Мой компьютер', key: 'computer' },
  { label: 'Корзина', key: 'trash' },
]

const START_MENU: MenuItem[] = [
  { label: 'Почта', key: 'mail' },
  { label: 'Обозреватель', key: 'browser' },
  null,
  { label: 'Документы' },
  { label: 'Настройки' },
  { label: 'Поиск' },
  null,
  { label: 'Завершение работы…' },
]

export class Desktop {
  readonly canvas: HTMLCanvasElement
  dirty = true

  private ctx: CanvasRenderingContext2D
  private sound: Sound
  private windows: Win[] = []
  private cache = new Map<string, App>()
  private zTop = 10
  private startOpen = false
  private selectedIcon = -1
  private drag: { win: Win; ox: number; oy: number } | null = null
  private grain: CanvasPattern | null = null
  private lastMinute = -1

  constructor(sound: Sound) {
    this.sound = sound
    const canvas = document.createElement('canvas')
    canvas.width = DESKTOP_W
    canvas.height = DESKTOP_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d недоступен')
    this.canvas = canvas
    this.ctx = ctx
    this.grain = this.makeGrain(ctx)
    this.open('browser', true)
  }

  // ── жизненный цикл ───────────────────────────────────────────────

  tick(): void {
    const minute = new Date().getMinutes()
    if (minute !== this.lastMinute) {
      this.lastMinute = minute
      this.dirty = true
    }
  }

  draw(): void {
    const ctx = this.ctx
    fill(ctx, { x: 0, y: 0, w: DESKTOP_W, h: DESKTOP_H }, C.desk)
    if (this.grain) {
      ctx.fillStyle = this.grain
      ctx.fillRect(0, 0, DESKTOP_W, DESKTOP_H - TASKBAR)
    }
    this.drawIcons()

    const active = this.activeWin()
    const visible = this.windows.filter((w) => !w.min).sort((a, b) => a.z - b.z)
    for (const win of visible) this.drawWindow(win, win === active)

    this.drawTaskbar()
    if (this.startOpen) this.drawStartMenu()
    this.scanlines()
  }

  /** Горизонтальные полосы CRT поверх всего рабочего стола. */
  private scanlines(): void {
    const ctx = this.ctx
    ctx.fillStyle = 'rgba(0, 0, 0, 0.06)'
    for (let y = 0; y < DESKTOP_H; y += 3) ctx.fillRect(0, y, DESKTOP_W, 1)
    const g = ctx.createRadialGradient(DESKTOP_W / 2, DESKTOP_H / 2, DESKTOP_H * 0.35, DESKTOP_W / 2, DESKTOP_H / 2, DESKTOP_H * 0.95)
    g.addColorStop(0, 'rgba(0, 0, 0, 0)')
    g.addColorStop(1, 'rgba(0, 0, 0, 0.35)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, DESKTOP_W, DESKTOP_H)
  }

  private makeGrain(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    const n = document.createElement('canvas')
    n.width = 64
    n.height = 64
    const c = n.getContext('2d')
    if (!c) return null
    const img = c.createImageData(64, 64)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = 16
    }
    c.putImageData(img, 0, 0)
    return ctx.createPattern(n, 'repeat')
  }

  // ── окна ─────────────────────────────────────────────────────────

  private makeApp(key: string): App {
    if (key === 'browser') return new Browser(this.sound)
    if (key === 'mail') return new Mail(this.sound)
    if (key === 'computer') {
      return new Note('Мой компьютер', [
        'Локальный диск C:\\ — 0 байт свободно.',
        'Сетевой диск Z:\\ — нет доступа.',
        '',
        'Устройства: монитор, клавиатура, мышь, принтер.',
      ])
    }
    return new Note('Корзина', ['Корзина пуста.', '', 'Здесь ничего нет. Пока.'])
  }

  private open(key: string, silent = false): void {
    const existing = this.windows.find((w) => w.key === key)
    if (existing) {
      existing.min = false
      this.raise(existing)
    } else {
      let app = this.cache.get(key)
      if (!app) {
        app = this.makeApp(key)
        this.cache.set(key, app)
      }
      const s = SIZES[key] ?? { x: 260, y: 160, w: 340, h: 200 }
      this.windows.push({
        key,
        app,
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        z: ++this.zTop,
        min: false,
        max: false,
        restore: null,
      })
    }
    this.startOpen = false
    this.dirty = true
    if (!silent) this.sound.open()
  }

  private close(win: Win): void {
    this.windows = this.windows.filter((w) => w !== win)
    this.dirty = true
    this.sound.close()
  }

  private raise(win: Win): void {
    win.z = ++this.zTop
    this.dirty = true
  }

  private activeWin(): Win | null {
    let best: Win | null = null
    for (const w of this.windows) {
      if (w.min) continue
      if (!best || w.z > best.z) best = w
    }
    return best
  }

  private contentRect(win: Win): Rect {
    return { x: win.x + 4, y: win.y + TITLE + 2, w: win.w - 8, h: win.h - TITLE - 6 }
  }

  private drawWindow(win: Win, active: boolean): void {
    const ctx = this.ctx
    panel(ctx, { x: win.x, y: win.y, w: win.w, h: win.h }, true, 2)

    const bar: Rect = { x: win.x + 3, y: win.y + 3, w: win.w - 6, h: 16 }
    const g = ctx.createLinearGradient(bar.x, bar.y, bar.x, bar.y + bar.h)
    if (active) {
      g.addColorStop(0, C.titleOn2)
      g.addColorStop(1, C.titleOn)
    } else {
      g.addColorStop(0, '#7a7a72')
      g.addColorStop(1, C.titleOff)
    }
    ctx.fillStyle = g
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h)

    const buttons = this.titleButtons(win)
    ctx.save()
    ctx.beginPath()
    ctx.rect(bar.x, bar.y, bar.w - 54, bar.h)
    ctx.clip()
    text(ctx, win.app.title, bar.x + 5, bar.y + 8.5, { size: 12, bold: true, color: C.titleText })
    ctx.restore()

    for (const b of buttons) {
      panel(ctx, b.r, true, 1)
      ctx.strokeStyle = C.text
      ctx.lineWidth = 1
      const cx = b.r.x + b.r.w / 2
      const cy = b.r.y + b.r.h / 2
      ctx.beginPath()
      if (b.kind === 'close') {
        ctx.moveTo(cx - 3, cy - 3)
        ctx.lineTo(cx + 3, cy + 3)
        ctx.moveTo(cx + 3, cy - 3)
        ctx.lineTo(cx - 3, cy + 3)
      } else if (b.kind === 'min') {
        ctx.moveTo(cx - 4, cy + 3)
        ctx.lineTo(cx + 4, cy + 3)
      } else {
        ctx.rect(cx - 4, cy - 3, 8, 7)
        ctx.moveTo(cx - 4, cy - 1)
        ctx.lineTo(cx + 4, cy - 1)
      }
      ctx.stroke()
    }

    const cr = this.contentRect(win)
    fill(ctx, cr, C.face)
    ctx.save()
    ctx.beginPath()
    ctx.rect(cr.x, cr.y, cr.w, cr.h)
    ctx.clip()
    win.app.draw(ctx, cr)
    ctx.restore()
  }

  private titleButtons(win: Win): Array<{ r: Rect; kind: 'close' | 'min' | 'max' }> {
    const y = win.y + 4
    const h = 14
    const w = 16
    const close: Rect = { x: win.x + win.w - 5 - w, y, w, h }
    const max: Rect = { x: close.x - w - 2, y, w, h }
    const min: Rect = { x: max.x - w - 2, y, w, h }
    return [
      { r: min, kind: 'min' },
      { r: max, kind: 'max' },
      { r: close, kind: 'close' },
    ]
  }

  // ── иконки ───────────────────────────────────────────────────────

  private iconRect(i: number): Rect {
    return { x: 14, y: 12 + i * 84, w: 84, h: 78 }
  }

  private drawIcons(): void {
    const ctx = this.ctx
    ICONS.forEach((icon, i) => {
      const r = this.iconRect(i)
      if (i === this.selectedIcon) {
        ctx.fillStyle = 'rgba(20, 40, 60, 0.45)'
        ctx.fillRect(r.x, r.y, r.w, r.h)
      }
      this.drawGlyph(icon.key, r.x + r.w / 2, r.y + 30)

      setFont(ctx, 11)
      const lines = icon.label.split(' ')
      let y = r.y + 56
      for (const line of lines) {
        text(ctx, line, r.x + r.w / 2 + 1, y + 1, { size: 11, color: '#000000', align: 'center' })
        text(ctx, line, r.x + r.w / 2, y, { size: 11, color: C.deskText, align: 'center' })
        y += 13
      }
    })
  }

  private drawGlyph(key: string, cx: number, cy: number): void {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(cx, cy)
    if (key === 'mail') {
      fill(ctx, { x: -21, y: -14, w: 42, h: 28 }, '#d9d4c0')
      ctx.strokeStyle = '#3a3a32'
      ctx.strokeRect(-20.5, -13.5, 41, 27)
      ctx.beginPath()
      ctx.moveTo(-20, -13)
      ctx.lineTo(0, 2)
      ctx.lineTo(20, -13)
      ctx.stroke()
    } else if (key === 'browser') {
      ctx.fillStyle = '#1d3f74'
      ctx.beginPath()
      ctx.arc(0, 0, 17, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#9fc3e8'
      ctx.beginPath()
      ctx.ellipse(0, 0, 7, 17, 0, 0, Math.PI * 2)
      ctx.moveTo(-17, 0)
      ctx.lineTo(17, 0)
      ctx.stroke()
    } else if (key === 'computer') {
      fill(ctx, { x: -21, y: -16, w: 42, h: 30 }, '#8d8a80')
      fill(ctx, { x: -17, y: -12, w: 34, h: 22 }, '#123027')
      ctx.strokeStyle = '#2b2b25'
      ctx.strokeRect(-20.5, -15.5, 41, 29)
      fill(ctx, { x: -7, y: 14, w: 14, h: 4 }, '#6f6c63')
    } else {
      fill(ctx, { x: -14, y: -10, w: 28, h: 26 }, '#5b5f5c')
      fill(ctx, { x: -17, y: -15, w: 34, h: 5 }, '#777c78')
      ctx.strokeStyle = '#23231f'
      ctx.beginPath()
      ctx.moveTo(-14, -9)
      ctx.lineTo(14, -9)
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── панель задач и меню ──────────────────────────────────────────

  private drawTaskbar(): void {
    const ctx = this.ctx
    const top = DESKTOP_H - TASKBAR
    fill(ctx, { x: 0, y: top, w: DESKTOP_W, h: TASKBAR }, C.face)
    bevel(ctx, { x: 0, y: top, w: DESKTOP_W, h: TASKBAR }, true, 1)

    const start: Rect = { x: 3, y: top + 3, w: 70, h: 23 }
    panel(ctx, start, this.startOpen, 2)
    const flag = ['#8a1c1c', '#1c5a2a', '#1b3a6b', '#a08b1a']
    for (let i = 0; i < 4; i++) {
      fill(
        ctx,
        { x: start.x + 7 + (i % 2) * 7, y: start.y + 5 + Math.floor(i / 2) * 7, w: 6, h: 6 },
        flag[i],
      )
    }
    text(ctx, 'Пуск', start.x + 24, start.y + 11, { size: 12, bold: true })

    let x = 79
    const active = this.activeWin()
    for (const win of this.windows) {
      const r: Rect = { x, y: top + 3, w: 148, h: 23 }
      panel(ctx, r, !(win === active && !win.min), 2)
      text(ctx, win.app.title, r.x + 7, r.y + 11, {
        size: 12,
        bold: win === active && !win.min,
        color: win.min ? C.textDim : C.text,
      })
      x += 151
    }

    const clock: Rect = { x: DESKTOP_W - 62, y: top + 3, w: 58, h: 23 }
    panel(ctx, clock, false, 2)
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    text(ctx, `${hh}:${mm}`, clock.x + clock.w / 2, clock.y + 11, { size: 12, align: 'center' })
  }

  private menuLayout(): { rect: Rect; items: Array<{ r: Rect; label: string; key?: string }> } {
    const width = 200
    let height = 8
    for (const item of START_MENU) height += item ? 23 : 7
    const x = 3
    const y = DESKTOP_H - TASKBAR - height
    const items: Array<{ r: Rect; label: string; key?: string }> = []
    let cursor = y + 4
    for (const item of START_MENU) {
      if (!item) {
        cursor += 7
        continue
      }
      items.push({ r: { x: x + 4, y: cursor, w: width - 8, h: 22 }, label: item.label, key: item.key })
      cursor += 23
    }
    return { rect: { x, y, w: width, h: height }, items }
  }

  private drawStartMenu(): void {
    const ctx = this.ctx
    const { rect, items } = this.menuLayout()
    panel(ctx, rect, true, 2)
    fill(ctx, { x: rect.x + 2, y: rect.y + 2, w: 20, h: rect.h - 4 }, C.titleOn)
    for (const item of items) {
      text(ctx, item.label, item.r.x + 26, item.r.y + 11, { size: 12 })
    }
  }

  // ── ввод ─────────────────────────────────────────────────────────

  pointerDown(x: number, y: number): void {
    if (this.startOpen) {
      const { rect, items } = this.menuLayout()
      if (inside(rect, x, y)) {
        for (const item of items) {
          if (inside(item.r, x, y)) {
            if (item.key) this.open(item.key)
            else {
              this.startOpen = false
              this.sound.error()
            }
            return
          }
        }
        return
      }
      this.startOpen = false
      this.dirty = true
    }

    if (y >= DESKTOP_H - TASKBAR) {
      if (x < 76) {
        this.startOpen = !this.startOpen
        this.dirty = true
        this.sound.click()
        return
      }
      let bx = 79
      for (const win of this.windows) {
        if (x >= bx && x < bx + 148) {
          const active = this.activeWin()
          if (win === active && !win.min) {
            win.min = true
            this.dirty = true
            this.sound.click()
          } else {
            win.min = false
            this.raise(win)
            this.sound.click()
          }
          return
        }
        bx += 151
      }
      return
    }

    for (let i = 0; i < ICONS.length; i++) {
      if (inside(this.iconRect(i), x, y)) {
        this.selectedIcon = i
        this.open(ICONS[i].key)
        return
      }
    }

    const ordered = this.windows.filter((w) => !w.min).sort((a, b) => b.z - a.z)
    for (const win of ordered) {
      const buttons = this.titleButtons(win)
      for (const b of buttons) {
        if (inside(b.r, x, y)) {
          this.raise(win)
          if (b.kind === 'close') this.close(win)
          else if (b.kind === 'min') {
            win.min = true
            this.dirty = true
            this.sound.click()
          } else {
            if (win.max && win.restore) {
              const r = win.restore
              win.x = r.x
              win.y = r.y
              win.w = r.w
              win.h = r.h
              win.max = false
            } else {
              win.restore = { x: win.x, y: win.y, w: win.w, h: win.h }
              win.x = 0
              win.y = 0
              win.w = DESKTOP_W
              win.h = DESKTOP_H - TASKBAR
              win.max = true
            }
            this.dirty = true
            this.sound.click()
          }
          return
        }
      }

      const bar: Rect = { x: win.x + 3, y: win.y + 3, w: win.w - 6, h: 16 }
      if (inside(bar, x, y)) {
        this.raise(win)
        this.drag = { win, ox: x - win.x, oy: y - win.y }
        return
      }

      const cr = this.contentRect(win)
      if (inside(cr, x, y)) {
        this.raise(win)
        win.app.click(x, y, cr)
        this.dirty = true
        return
      }
    }

    this.selectedIcon = -1
    this.dirty = true
  }

  pointerMove(x: number, y: number): void {
    if (!this.drag) return
    const { win, ox, oy } = this.drag
    if (win.max) return
    win.x = Math.max(-win.w + 90, Math.min(DESKTOP_W - 90, x - ox))
    win.y = Math.max(0, Math.min(DESKTOP_H - TASKBAR - 26, y - oy))
    this.dirty = true
  }

  pointerUp(): void {
    this.drag = null
  }

  isDragging(): boolean {
    return this.drag !== null
  }
}
