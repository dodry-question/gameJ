import { C, bevel, fill, inside, panel, text } from './draw'
import type { Rect } from './draw'
import { drawIcon } from './icons'
import type { App } from './app'
import { Browser } from './apps/browser'
import { Camera } from './apps/camera'
import { Explorer } from './apps/explorer'
import { Mail } from './apps/mail'
import { Note } from './apps/note'
import type { Sound } from '../audio'

export const DESKTOP_W = 960
export const DESKTOP_H = 720

const TASKBAR = 30
const TITLE = 20

/** Размер ячейки ярлыка: 64 px значок + подпись в две строки. */
const ICON_W = 88
const ICON_H = 92

/** Сколько «грузится» программа: браузер тяжелее блокнота. */
const LAUNCH_MS: Record<string, number> = {
  browser: 1500,
  mail: 1100,
  camera: 1300,
  computer: 550,
  trash: 450,
}

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

/** Ярлык на рабочем столе. Координаты — левый верхний угол ячейки. */
type DeskIcon = {
  id: string
  label: string
  glyph: string
  app: string
  x: number
  y: number
}

const SIZES: Record<string, Rect> = {
  browser: { x: 120, y: 52, w: 640, h: 486 },
  mail: { x: 250, y: 100, w: 620, h: 476 },
  computer: { x: 280, y: 110, w: 580, h: 400 },
  trash: { x: 300, y: 190, w: 350, h: 180 },
  camera: { x: 236, y: 86, w: 560, h: 470 },
}

const START_ICONS: Array<Omit<DeskIcon, 'x' | 'y'>> = [
  { id: 'mail', label: 'Почта', glyph: 'mail', app: 'mail' },
  { id: 'browser', label: 'Интернет', glyph: 'browser', app: 'browser' },
  { id: 'computer', label: 'Мой компьютер', glyph: 'computer', app: 'computer' },
  { id: 'trash', label: 'Корзина', glyph: 'trash', app: 'trash' },
]

const START_MENU: MenuItem[] = [
  { label: 'Почта', key: 'mail' },
  { label: 'Netscape Navigator', key: 'browser' },
  { label: 'Мой компьютер', key: 'computer' },
  null,
  { label: 'Документы' },
  { label: 'Настройки' },
  { label: 'Поиск' },
  null,
  { label: 'Завершение работы…' },
]

type IconDrag = {
  ids: string[]
  startX: number
  startY: number
  orig: Map<string, { x: number; y: number }>
  moved: boolean
}

type Band = {
  x0: number
  y0: number
  x1: number
  y1: number
  base: Set<string>
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export class Desktop {
  readonly canvas: HTMLCanvasElement
  dirty = true

  private ctx: CanvasRenderingContext2D
  private sound: Sound
  private windows: Win[] = []
  private cache = new Map<string, App>()
  private zTop = 10
  private startOpen = false

  // ярлыки
  private icons: DeskIcon[] = []
  private selected = new Set<string>()
  private iconDrag: IconDrag | null = null
  private band: Band | null = null
  private lastClick = { id: '', at: 0 }

  // установка «вируса» и доступ к камере
  private install: { start: number; end: number } | null = null
  private threatSent = false
  private cameraAccess = false

  private drag: { win: Win; ox: number; oy: number } | null = null
  private grain: CanvasPattern | null = null
  private lastMinute = -1
  private pointer = { x: DESKTOP_W / 2, y: DESKTOP_H / 2, over: false }
  private pending: { key: string; end: number } | null = null
  private toast: { end: number; kind: 'mail' | 'file' } | null = null
  private notified = false
  private hasNewMail = false

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
    this.icons = START_ICONS.map((icon, i) => ({
      ...icon,
      x: 10,
      y: 8 + i * 94,
    }))
    // Через пять секунд после входа игрок должен понять, что от него хотят.
    window.setTimeout(() => this.notifyMail(), 5000)
  }

  // ── жизненный цикл ───────────────────────────────────────────────

  tick(): void {
    const now = performance.now()

    if (this.pending && now >= this.pending.end) {
      const key = this.pending.key
      this.pending = null
      this.spawn(key)
    }

    if (this.install && now >= this.install.end) {
      this.install = null
      this.dropPayload()
      this.toast = { end: now + 10000, kind: 'file' }
      this.sound.message()
      this.dirty = true
    }

    if (this.toast && now >= this.toast.end) {
      this.toast = null
      this.dirty = true
    }

    // Анимация внутри открытых окон (камера).
    for (const win of this.windows) {
      if (win.min) continue
      if (win.app.tick?.()) this.dirty = true
    }

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
    this.drawBand()

    const active = this.activeWin()
    const visible = this.windows.filter((w) => !w.min).sort((a, b) => a.z - b.z)
    for (const win of visible) this.drawWindow(win, win === active)

    this.drawTaskbar()
    if (this.startOpen) this.drawStartMenu()
    if (this.install) this.drawInstall()
    if (this.toast) this.drawToast()
    this.drawCursor()
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
    if (key === 'mail') return this.getMail()
    if (key === 'computer') return new Explorer(this.sound)
    if (key === 'camera') {
      const cam = new Camera(this.sound)
      cam.setAccess(this.cameraAccess)
      return cam
    }
    return new Note('Корзина', ['Корзина пуста.', '', 'Здесь ничего нет. Пока.'])
  }

  private getMail(): Mail {
    const cached = this.cache.get('mail')
    if (cached instanceof Mail) return cached
    const mail = new Mail(this.sound)
    mail.onDownload = () => this.beginInstall()
    mail.onThreatRead = () => this.grantCamera()
    this.cache.set('mail', mail)
    return mail
  }

  private open(key: string): void {
    if (key === 'mail') {
      this.hasNewMail = false
      this.dirty = true
    }
    // Первый запуск файла из архива: на экране появляется камера и приходит письмо.
    if (key === 'camera' && !this.threatSent) {
      this.threatSent = true
      this.deliverThreat()
    }

    const existing = this.windows.find((w) => w.key === key)
    if (existing) {
      existing.min = false
      this.raise(existing)
      this.startOpen = false
      this.dirty = true
      this.sound.open()
      return
    }
    if (this.pending) return
    this.startOpen = false
    // Настоящая винда не открывает окно мгновенно: пока грузится — песочные часы.
    this.pending = { key, end: performance.now() + (LAUNCH_MS[key] ?? 700) }
    this.sound.busy()
    this.dirty = true
  }

  private spawn(key: string): void {
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
    this.dirty = true
    this.sound.open()
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

  // ── ярлыки ───────────────────────────────────────────────────────

  private iconRect(icon: DeskIcon): Rect {
    return { x: icon.x, y: icon.y, w: ICON_W, h: ICON_H }
  }

  private clearSelection(): void {
    if (this.selected.size === 0) return
    this.selected.clear()
    this.dirty = true
  }

  private drawIcons(): void {
    const ctx = this.ctx
    for (const icon of this.icons) {
      const r = this.iconRect(icon)
      if (this.selected.has(icon.id)) {
        ctx.fillStyle = 'rgba(24, 52, 92, 0.55)'
        ctx.fillRect(r.x, r.y, r.w, r.h)
        ctx.strokeStyle = 'rgba(160, 190, 230, 0.45)'
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
      }
      drawIcon(ctx, icon.glyph, r.x + r.w / 2, r.y + 32)

      if (icon.app === 'mail' && this.hasNewMail) {
        const badge: Rect = { x: r.x + r.w / 2 + 16, y: r.y + 4, w: 16, h: 15 }
        fill(ctx, badge, C.alert)
        ctx.strokeStyle = '#1a1a14'
        ctx.strokeRect(badge.x + 0.5, badge.y + 0.5, badge.w - 1, badge.h - 1)
        text(ctx, '1', badge.x + badge.w / 2, badge.y + badge.h / 2 + 0.5, {
          size: 10,
          bold: true,
          color: '#ffffff',
          align: 'center',
        })
      }

      const lines = icon.label.split(' ')
      let y = r.y + 70
      for (const line of lines) {
        text(ctx, line, r.x + r.w / 2 + 1, y + 1, { size: 11, color: '#000000', align: 'center' })
        text(ctx, line, r.x + r.w / 2, y, { size: 11, color: C.deskText, align: 'center' })
        y += 13
      }
    }
  }

  /** Рамка выделения, как в проводнике Windows. */
  private drawBand(): void {
    if (!this.band) return
    const ctx = this.ctx
    const x = Math.min(this.band.x0, this.band.x1)
    const y = Math.min(this.band.y0, this.band.y1)
    const w = Math.abs(this.band.x1 - this.band.x0)
    const h = Math.abs(this.band.y1 - this.band.y0)
    if (w < 1 && h < 1) return

    ctx.fillStyle = 'rgba(90, 140, 200, 0.22)'
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = 'rgba(205, 225, 250, 0.85)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 2])
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    ctx.setLineDash([])
  }

  /** Обновить выделение под рамкой. */
  private updateBand(): void {
    if (!this.band) return
    const b = this.band
    const r: Rect = {
      x: Math.min(b.x0, b.x1),
      y: Math.min(b.y0, b.y1),
      w: Math.abs(b.x1 - b.x0),
      h: Math.abs(b.y1 - b.y0),
    }
    const next = new Set(b.base)
    for (const icon of this.icons) {
      if (intersects(this.iconRect(icon), r)) next.add(icon.id)
    }
    this.selected = next
    this.dirty = true
  }

  // ── установка файла из письма ────────────────────────────────────

  /** Архив скачан — «распаковываем» его с прогрессом, как настоящий вирус. */
  private beginInstall(): void {
    if (this.install || this.icons.some((i) => i.id === 'cam04')) return
    const now = performance.now()
    this.install = { start: now, end: now + 2800 }
    this.sound.busy()
    this.dirty = true
  }

  private dropPayload(): void {
    if (this.icons.some((i) => i.id === 'cam04')) return
    this.icons.push({
      id: 'cam04',
      label: 'cam04.exe',
      glyph: 'camera',
      app: 'camera',
      x: 104,
      y: 8,
    })
  }

  private drawInstall(): void {
    if (!this.install) return
    const ctx = this.ctx
    const now = performance.now()
    const p = clamp((now - this.install.start) / (this.install.end - this.install.start), 0, 1)

    const r: Rect = { x: (DESKTOP_W - 380) / 2, y: (DESKTOP_H - TASKBAR - 176) / 2, w: 380, h: 176 }
    panel(ctx, r, true, 2)

    const bar: Rect = { x: r.x + 3, y: r.y + 3, w: r.w - 6, h: 16 }
    const g = ctx.createLinearGradient(bar.x, bar.y, bar.x, bar.y + bar.h)
    g.addColorStop(0, C.titleOn2)
    g.addColorStop(1, C.titleOn)
    ctx.fillStyle = g
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h)
    text(ctx, 'Установка', bar.x + 5, bar.y + 8.5, { size: 12, bold: true, color: C.titleText })

    const x = r.x + 18
    let y = r.y + 34
    text(ctx, 'Распаковка cam04-archive.zip', x, y, { size: 12, bold: true })
    y += 18
    text(ctx, 'Файл будет помещён на рабочий стол.', x, y, { size: 11, color: C.textDim })

    const track: Rect = { x, y: y + 16, w: r.w - 36, h: 20 }
    panel(ctx, track, false, 2)
    const inner: Rect = { x: track.x + 2, y: track.y + 2, w: track.w - 4, h: track.h - 4 }
    fill(ctx, inner, '#8e8e86')
    const done: Rect = { ...inner, w: Math.round(inner.w * p) }
    fill(ctx, done, '#2c4f86')
    // деления, как у индикатора Win2000
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
    for (let sx = inner.x + 12; sx < inner.x + inner.w; sx += 12) ctx.fillRect(sx, inner.y, 1, inner.h)

    text(ctx, `${Math.round(p * 100)}%`, x, track.y + track.h + 14, { size: 11, color: C.textDim })
    text(ctx, 'Не выключайте компьютер.', r.x + r.w - 18, track.y + track.h + 14, {
      size: 11,
      color: C.textDim,
      align: 'right',
    })
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

  // ── уведомление о письме ─────────────────────────────────────────

  /** Новое письмо и всплывающее уведомление в стиле Win2000. */
  private notifyMail(): void {
    if (this.notified) return
    this.notified = true
    this.deliverMail()
    this.toast = { end: performance.now() + 12000, kind: 'mail' }
    this.hasNewMail = true
    this.sound.message()
    this.dirty = true
  }

  private deliverMail(): void {
    this.getMail().deliver()
    this.dirty = true
  }

  /** Письмо от похитителей приходит в момент первого запуска cam04.exe. */
  private deliverThreat(): void {
    this.getMail().deliverThreat()
    this.hasNewMail = true
    this.toast = { end: performance.now() + 12000, kind: 'mail' }
    this.sound.message()
    this.dirty = true
  }

  /** Игрок прочитал письмо — замок камеры разблокирован. */
  private grantCamera(): void {
    this.cameraAccess = true
    const cam = this.cache.get('camera')
    if (cam instanceof Camera) cam.setAccess(true)
    this.dirty = true
  }

  private toastRect(): Rect {
    return { x: DESKTOP_W - 300, y: DESKTOP_H - TASKBAR - 104, w: 292, h: 96 }
  }

  private drawToast(): void {
    if (!this.toast) return
    const ctx = this.ctx
    const r = this.toastRect()
    panel(ctx, r, true, 2)

    const bar: Rect = { x: r.x + 3, y: r.y + 3, w: r.w - 6, h: 16 }
    const g = ctx.createLinearGradient(bar.x, bar.y, bar.x, bar.y + bar.h)
    g.addColorStop(0, C.titleOn2)
    g.addColorStop(1, C.titleOn)
    ctx.fillStyle = g
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h)
    text(ctx, this.toast.kind === 'file' ? 'Установка' : 'Почта', bar.x + 5, bar.y + 8.5, {
      size: 11,
      bold: true,
      color: C.titleText,
    })

    const close: Rect = { x: r.x + r.w - 21, y: r.y + 4, w: 16, h: 14 }
    panel(ctx, close, true, 1)
    ctx.strokeStyle = C.text
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(close.x + 4.5, close.y + 4)
    ctx.lineTo(close.x + 11.5, close.y + 10)
    ctx.moveTo(close.x + 11.5, close.y + 4)
    ctx.lineTo(close.x + 4.5, close.y + 10)
    ctx.stroke()

    if (this.toast.kind === 'file') {
      drawIcon(ctx, 'camera', r.x + 28, r.y + 44, 1)
      text(ctx, 'Установка завершена', r.x + 50, r.y + 32, { size: 12, bold: true })
      text(ctx, 'На рабочем столе: cam04.exe', r.x + 50, r.y + 50, { size: 11, color: C.alert })
      text(ctx, 'Запустите файл, чтобы открыть камеру', r.x + 50, r.y + 68, {
        size: 10,
        color: C.textDim,
      })
      return
    }

    // конверт
    const ex = r.x + 14
    const ey = r.y + 30
    fill(ctx, { x: ex, y: ey, w: 28, h: 19 }, '#d9d4c0')
    ctx.strokeStyle = '#3a3a32'
    ctx.strokeRect(ex + 0.5, ey + 0.5, 27, 18)
    ctx.beginPath()
    ctx.moveTo(ex + 1, ey + 1)
    ctx.lineTo(ex + 14, ey + 11)
    ctx.lineTo(ex + 27, ey + 1)
    ctx.stroke()

    text(ctx, 'Входящие: новое сообщение', r.x + 50, r.y + 32, { size: 12, bold: true })
    text(ctx, 'Вложение: cam04-archive.zip', r.x + 50, r.y + 50, { size: 11, color: C.alert })
    text(ctx, 'Нажмите, чтобы открыть', r.x + 50, r.y + 68, { size: 10, color: C.textDim })
  }

  // ── курсор ───────────────────────────────────────────────────────

  /** Курсор рисуется в текстуре экрана, поэтому живёт под scanlines, как в CRT. */
  private drawCursor(): void {
    // Системную стрелку не подменяем: у игрока своя чувствительность и размер.
    // Вручную рисуем только песочные часы — их в системе не заменить.
    if (!this.pending) return
    const { x, y, over } = this.pointer
    if (!over) return
    if (x < 0 || y < 0 || x >= DESKTOP_W || y >= DESKTOP_H) return
    this.drawHourglass(x, y)
  }

  /** Песочные часы Windows 2000: чёрный контур, белый корпус, чёрный песок. */
  private drawHourglass(x: number, y: number): void {
    const ctx = this.ctx
    const w = 6.5
    const h = 11
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(x - w, y - h)
    ctx.lineTo(x + w, y - h)
    ctx.lineTo(x + 0.9, y)
    ctx.lineTo(x + w, y + h)
    ctx.lineTo(x - w, y + h)
    ctx.lineTo(x - 0.9, y)
    ctx.closePath()
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 1.2
    ctx.lineJoin = 'round'
    ctx.stroke()

    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.moveTo(x - w + 1.2, y - h + 1.6)
    ctx.lineTo(x + w - 1.2, y - h + 1.6)
    ctx.lineTo(x + 0.5, y - h * 0.4)
    ctx.lineTo(x - 0.5, y - h * 0.4)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x - w + 1.2, y + h - 1.6)
    ctx.lineTo(x + w - 1.2, y + h - 1.6)
    ctx.lineTo(x + 0.5, y + h * 0.3)
    ctx.lineTo(x - 0.5, y + h * 0.3)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // ── ввод ─────────────────────────────────────────────────────────

  pointerDown(x: number, y: number, shift = false): void {
    this.pointer.x = x
    this.pointer.y = y
    this.pointer.over = true

    // Модальное окно установки перекрывает рабочий стол целиком.
    if (this.install) return

    if (this.toast) {
      const r = this.toastRect()
      if (inside(r, x, y)) {
        const close: Rect = { x: r.x + r.w - 21, y: r.y + 4, w: 16, h: 14 }
        const kind = this.toast.kind
        this.toast = null
        this.dirty = true
        if (inside(close, x, y)) this.sound.click()
        else if (kind === 'mail') this.open('mail')
        return
      }
    }

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
      this.clearSelection()
      if (x < 76) {
        this.startOpen = !this.startOpen
        this.dirty = true
        this.sound.menu()
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

    // Окна лежат поверх ярлыков, поэтому сначала окна — сверху вниз по z.
    const ordered = this.windows.filter((w) => !w.min).sort((a, b) => b.z - a.z)
    for (const win of ordered) {
      const buttons = this.titleButtons(win)
      for (const b of buttons) {
        if (inside(b.r, x, y)) {
          this.clearSelection()
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
        this.clearSelection()
        this.raise(win)
        this.drag = { win, ox: x - win.x, oy: y - win.y }
        return
      }

      const cr = this.contentRect(win)
      if (inside(cr, x, y)) {
        this.clearSelection()
        this.raise(win)
        win.app.click(x, y, cr)
        this.dirty = true
        return
      }
    }

    // Ярлыки: клик выделяет, двойной клик открывает, перетаскивание двигает.
    for (let i = this.icons.length - 1; i >= 0; i--) {
      const icon = this.icons[i]
      if (!inside(this.iconRect(icon), x, y)) continue

      const now = performance.now()
      if (this.lastClick.id === icon.id && now - this.lastClick.at < 450) {
        this.lastClick = { id: '', at: 0 }
        this.open(icon.app)
        return
      }
      this.lastClick = { id: icon.id, at: now }

      if (shift) {
        if (this.selected.has(icon.id)) this.selected.delete(icon.id)
        else this.selected.add(icon.id)
      } else if (!this.selected.has(icon.id)) {
        this.selected = new Set([icon.id])
      }

      const orig = new Map<string, { x: number; y: number }>()
      for (const id of this.selected) {
        const it = this.icons.find((v) => v.id === id)
        if (it) orig.set(id, { x: it.x, y: it.y })
      }
      this.iconDrag = {
        ids: [...this.selected],
        startX: x,
        startY: y,
        orig,
        moved: false,
      }
      this.sound.click()
      this.dirty = true
      return
    }

    // Пустое место: рамка выделения, как в проводнике.
    if (!shift) this.selected.clear()
    this.band = {
      x0: x,
      y0: y,
      x1: x,
      y1: y,
      base: new Set(this.selected),
    }
    this.dirty = true
  }

  pointerMove(x: number, y: number): void {
    if (x !== this.pointer.x || y !== this.pointer.y || !this.pointer.over) this.dirty = true
    this.pointer.x = x
    this.pointer.y = y
    this.pointer.over = true

    if (this.band) {
      this.band.x1 = x
      this.band.y1 = y
      this.updateBand()
      return
    }

    if (this.iconDrag) {
      const d = this.iconDrag
      const dx = x - d.startX
      const dy = y - d.startY
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
      if (d.moved) {
        for (const id of d.ids) {
          const icon = this.icons.find((v) => v.id === id)
          const o = d.orig.get(id)
          if (!icon || !o) continue
          icon.x = clamp(o.x + dx, 0, DESKTOP_W - ICON_W)
          icon.y = clamp(o.y + dy, 0, DESKTOP_H - TASKBAR - ICON_H)
        }
        this.dirty = true
      }
      return
    }

    if (!this.drag) return
    const { win, ox, oy } = this.drag
    if (win.max) return
    win.x = Math.max(-win.w + 90, Math.min(DESKTOP_W - 90, x - ox))
    win.y = Math.max(0, Math.min(DESKTOP_H - TASKBAR - 26, y - oy))
    this.dirty = true
  }

  /** Мышь ушла с экрана монитора — курсор на столе больше не рисуем. */
  pointerOut(): void {
    if (!this.pointer.over) return
    this.pointer.over = false
    this.dirty = true
  }

  pointerUp(): void {
    this.drag = null
    this.iconDrag = null
    if (this.band) {
      this.band = null
      this.dirty = true
    }
  }

  isDragging(): boolean {
    return this.drag !== null || (this.iconDrag?.moved ?? false) || this.band !== null
  }

  /** Идёт «загрузка» программы или установка файла: на экране нужны песочные часы. */
  isBusy(): boolean {
    return this.pending !== null || this.install !== null
  }
}
