import { C, bevel, ellipsis, fill, inside, panel, text } from './draw'
import type { Rect } from './draw'
import { drawIcon } from './icons'
import type { App } from './app'
import { Browser } from './apps/browser'
import { Explorer } from './apps/explorer'
import type { DeskFile } from './apps/explorer'
import { ImageViewer } from './apps/image-viewer'
import { MusicPlayer } from './apps/music-player'
import { Mail } from './apps/mail'
import { Note } from './apps/note'
import { Notepad } from './apps/notepad'
import { Tds } from './apps/tds'
import type { Sound } from '../audio'
import { getCctv, WALK_S } from '../cctv'

export const DESKTOP_W = 960
export const DESKTOP_H = 720

const TASKBAR = 30
const TITLE = 20

/** Адрес панели сброса замка: терминал выдаёт его блокнотом. */
const LOCK_URL = 'http://lockreset.local/'

const DOOR_NOTE = [
  'TDS 2.1 · СБРОС БЛОКИРОВКИ ДВЕРИ',
  '--------------------------------',
  '',
  'Замок двери блока C заражен: аномальные узлы',
  'шлют сигнал блокировки на сервер терминала.',
  '',
  'Панель сброса:',
  `    ${LOCK_URL}`,
  '',
  '1. Скопируй адрес.',
  '2. Вставь его в Netscape Navigator и открой.',
  '3. Очисти все зараженные узлы на схеме.',
  '',
  'Дверь отопрется автоматически.',
].join('\n')

/** Размер ячейки ярлыка: 64 px значок + подпись в две строки. */
const ICON_W = 88
const ICON_H = 92

/** Сколько «грузится» программа: браузер тяжелее блокнота. */
const LAUNCH_MS: Record<string, number> = {
  browser: 1500,
  mail: 1100,
  tds: 900,
  notepad: 650,
  computer: 550,
  trash: 450,
  image: 450,
  music: 0,
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
  tds: { x: 120, y: 52, w: 720, h: 560 },
  notepad: { x: 190, y: 84, w: 540, h: 420 },
  computer: { x: 280, y: 110, w: 580, h: 400 },
  trash: { x: 300, y: 190, w: 350, h: 180 },
  image: { x: 230, y: 100, w: 500, h: 510 },
  music: { x: 320, y: 200, w: 300, h: 234 },
}

/** Терминал открывается развёрнутым: карта должна занимать весь экран. */
const MAX_ON_OPEN = new Set(['tds'])

const START_ICONS: Array<Omit<DeskIcon, 'x' | 'y'>> = [
  { id: 'mail', label: 'Почта', glyph: 'mail', app: 'mail' },
  { id: 'browser', label: 'Интернет', glyph: 'browser', app: 'browser' },
  { id: 'notepad', label: 'Блокнот', glyph: 'file', app: 'notepad' },
  { id: 'computer', label: 'Мой компьютер', glyph: 'computer', app: 'computer' },
  { id: 'trash', label: 'Корзина', glyph: 'trash', app: 'trash' },
]

const START_MENU: MenuItem[] = [
  { label: 'Почта', key: 'mail' },
  { label: 'Netscape Navigator', key: 'browser' },
  { label: 'Блокнот', key: 'notepad' },
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
  /** Ярлык, за который взялись мышью: по нему считается сдвиг всей группы. */
  anchorId: string
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

/**
 * Установка tds.exe: сначала честное скачивание файла с прогрессом, потом
 * на весь экран лезет вирус-тыква, медленно тает, и только затем идёт
 * обычный индикатор установки.
 */
type Install = {
  start: number
  /** Конец скачивания файла: до него — диалог загрузки. */
  dlEnd: number
  /** Конец показа вируса и конец его растворения. */
  holdEnd: number
  fadeEnd: number
  end: number
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
  /** Регулятор громкости в панели задач: открыт ли и тащим ли ползунок. */
  private volumeOpen = false
  private volumeDrag = false

  // ярлыки
  private icons: DeskIcon[] = []
  private selected = new Set<string>()
  private iconDrag: IconDrag | null = null
  private band: Band | null = null
  private lastClick = { id: '', at: 0 }
  /** Второй щелчок по ярлыку: откроем на отпускании, если не начали тащить. */
  private clickOpen: { app: string } | null = null

  // установка tds.exe из письма и доступ к камере
  private install: Install | null = null
  private threatSent = false
  private cameraAccess = false

  // сброс замка двери: адрес выдан блокнотом, дверь отперта
  private unlockNoteSent = false
  private doorUnlocked = false
  private pendingNote: { name: string; text: string } | null = null
  /** Какой файл открыть в окне просмотра при следующем spawn('image'). */
  private pendingImage: string | null = null

  // кухня: пароль, напечатанный с pairs.local, и исход головоломки
  private printedCode: string | null = null
  private pairsLostFlag = false
  /** Заметки оператора: важные реплики с кухни попадают в блокнот. */
  private noteText = ''
  /** Она погибла: с фазы выключения ПК клик перезапускает смену. */
  private girlDead = false
  /** Она выбралась через дверь: конец демо. */
  private escaped = false
  /**
   * Кино провала: ввод залочен, рабочий стол сам ведёт сцену — плашка
   * «Это на твоей совести», выключение ПК, темнота с дыханием.
   */
  private cinematic = false
  private cinePhase: 'none' | 'plaque' | 'shutdown' | 'black' = 'none'
  private cineAt = 0
  private offPlayed = false
  private breathStarted = false

  private drag: { win: Win; ox: number; oy: number } | null = null
  /** Протяжка внутри окна: выделение текста в блокноте. */
  private appDrag: Win | null = null
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
    ;(window as unknown as { __desk?: Desktop }).__desk = this
    // Исходы кухни: конец демо и кино провала — их рисует рабочий стол.
    const cctv = getCctv()
    cctv.onEscaped = () => {
      this.escaped = true
      this.dirty = true
    }
    cctv.onAttackPhase = (phase) => {
      if (phase === 'near') {
        // за секунду до касания: всё молчит, на экране — «Это на твоей совести»
        this.sound.muteAll()
        this.cinePhase = 'plaque'
        this.cineAt = performance.now()
        this.dirty = true
      }
      // 'touch' ничего не добавляет: кадр камеры застыл, ждём выключения
    }
    cctv.onNoteAppend = (line) => this.appendNote(line)
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

    if (this.install) {
      this.dirty = true
      if (now >= this.install.end) {
        this.install = null
        this.dropPayload()
        this.toast = { end: now + 10000, kind: 'file' }
        this.sound.message()
      }
    }

    if (this.toast && now >= this.toast.end) {
      this.toast = null
      this.dirty = true
    }

    // Кино провала: плашка → выключение ПК (без текстового экрана) → темнота.
    if (this.cinePhase === 'plaque' && now - this.cineAt >= 5000) {
      this.cinePhase = 'shutdown'
      this.cineAt = now
      this.girlDead = true // с этого момента клик перезапускает смену
      this.sound.unmute()
      this.sound.playShutdown()
      this.dirty = true
    }
    if (this.cinePhase === 'shutdown') {
      this.dirty = true
      const t = (now - this.cineAt) / 1000
      if (t >= 0.45 && !this.offPlayed) {
        this.offPlayed = true
        this.sound.monitorOff()
      }
      if (t >= 0.8 && !this.breathStarted) {
        // L-склейка: дыхание начинается чуть раньше полной темноты
        this.breathStarted = true
        this.sound.playDreadBreath(26000)
      }
      if (t >= 1.4) {
        this.cinePhase = 'black'
        this.cineAt = now
        this.dirty = true
      }
    }
    if (this.cinePhase === 'black') {
      // кадр чёрный, дыхание громчает сама шина; перерисовка ради подсказки
      this.dirty = true
    }

    // Анимация внутри открытых окон (камера).
    for (const win of this.windows) {
      if (win.min) continue
      if (win.app.tick?.()) this.dirty = true
    }
    // Дыхание слышно только пока в TDS открыт прямой эфир камеры; в кино
    // провала фоновые шины замолкают навсегда, даже если камера открыта.
    if (this.cinematic) {
      this.sound.setBreathing(null)
      this.sound.setCameraAudio(false)
    } else {
      const cameraOpen = this.windows.some(
        (w) => !w.min && w.app instanceof Tds && w.app.viewingCamera,
      )
      if (!cameraOpen) this.sound.setBreathing(null)
      // Звуки комнаты с камеры идут своей тихой шиной, пока страница открыта.
      this.sound.setCameraAudio(cameraOpen)
    }

    const minute = new Date().getMinutes()
    if (minute !== this.lastMinute) {
      this.lastMinute = minute
      this.dirty = true
    }
  }

  /** Клавиша активному окну: сейчас это нужно адресной строке браузера. */
  key(e: KeyboardEvent): boolean {
    // Кино провала само ведёт сцену: клавиатура ничего не должна трогать.
    if (this.cinematic) return true
    const win = this.activeWin()
    if (!win || !win.app.key) return false
    const handled = win.app.key(e)
    if (handled) this.dirty = true
    return handled
  }

  /** Вставка из буфера — туда же, в активное поле. */
  paste(text: string): boolean {
    const win = this.activeWin()
    if (!win || !win.app.paste) return false
    const handled = win.app.paste(text)
    if (handled) this.dirty = true
    return handled
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
    if (this.volumeOpen) this.drawVolume()
    if (this.cinePhase !== 'none') this.drawCinematic()
    else if (this.escaped) this.drawEscaped()
    this.drawCursor()
    this.scanlines()
  }

  /**
   * Кино провала: «Это на твоей совести» → выключение ПК → темнота,
   * из которой неспеша дышит кто-то ещё. Клик перезапускает смену.
   */
  private drawCinematic(): void {
    const ctx = this.ctx
    const now = performance.now()
    const full = { x: 0, y: 0, w: DESKTOP_W, h: DESKTOP_H }

    if (this.cinePhase === 'plaque') {
      // всё молчит: только слова на чёрном
      fill(ctx, full, '#020202')
      text(ctx, 'Это на твоей совести', DESKTOP_W / 2, DESKTOP_H / 2 - 12, {
        size: 30,
        bold: true,
        color: '#c8c4b8',
        align: 'center',
      })
      return
    }

    if (this.cinePhase === 'shutdown') {
      // текстового экрана «можно отключить» больше нет: плашка, вспышка,
      // сжимающаяся линия ЭЛТ — и сразу темнота
      const t = (now - this.cineAt) / 1000
      fill(ctx, full, '#020202')
      if (t < 0.25) {
        text(ctx, 'Это на твоей совести', DESKTOP_W / 2, DESKTOP_H / 2 - 12, {
          size: 30,
          bold: true,
          color: '#c8c4b8',
          align: 'center',
        })
      } else if (t < 0.6) {
        // CRT-схлопывание: яркая линия сжимается в точку и гаснет
        const p = (t - 0.25) / 0.35
        const w = Math.max(4, Math.round(DESKTOP_W * (1 - p)))
        const h = Math.max(2, Math.round(14 * (1 - p)) + 1)
        fill(
          ctx,
          { x: Math.round((DESKTOP_W - w) / 2), y: DESKTOP_H / 2 - Math.round(h / 2), w, h },
          '#e8e8e0',
        )
      }
      return
    }

    // black: темнота и дыхание; через десяток секунд — тихая подсказка
    fill(ctx, full, '#000000')
    if (now - this.cineAt > 12000 && Math.floor(now / 900) % 2 === 0) {
      text(ctx, 'клик — новая смена', DESKTOP_W / 2, DESKTOP_H / 2 + 120, {
        size: 12,
        color: 'rgba(120, 120, 112, 0.4)',
        align: 'center',
      })
    }
  }

  /** Она выбралась: конец демо-версии. */
  private drawEscaped(): void {
    const ctx = this.ctx
    fill(ctx, { x: 0, y: 0, w: DESKTOP_W, h: DESKTOP_H }, '#070c08')
    text(ctx, 'ОНА УШЛА', DESKTOP_W / 2, DESKTOP_H / 2 - 30, {
      size: 34,
      bold: true,
      color: '#9fd39f',
      align: 'center',
    })
    text(ctx, 'пароль подошёл, дверь позади. кто-то же должен был её спасти.', DESKTOP_W / 2, DESKTOP_H / 2 + 8, {
      size: 12,
      color: '#7e8c80',
      align: 'center',
    })
    const btn: Rect = { x: DESKTOP_W / 2 - 110, y: DESKTOP_H / 2 + 44, w: 220, h: 30 }
    panel(ctx, btn, true, 2)
    text(ctx, 'ПРОСМОТРЕТЬ ЗАНОВО', btn.x + btn.w / 2, btn.y + btn.h / 2, {
      size: 12,
      bold: true,
      align: 'center',
    })
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
    if (key === 'browser') {
      const browser = new Browser(this.sound)
      browser.onUnlockDoor = () => this.unlockDoor()
      browser.onPairsFail = () => this.pairsLost()
      browser.onPrintCode = (code) => this.printCode(code)
      browser.onPassword = (code) => getCctv().setExitCode(code)
      // игровые узлы открываются только «по сюжету»: иначе софт-лок
      browser.canOpenLock = () => this.cameraAccess
      browser.canOpenPairs = () => getCctv().kitchenReady
      return browser
    }
    if (key === 'mail') return this.getMail()
    if (key === 'tds') {
      const tds = new Tds(this.sound)
      tds.setAccess(this.cameraAccess)
      if (this.doorUnlocked) tds.doorOpened()
      tds.onFirstView = () => this.triggerThreat()
      tds.onDoorRequest = () => this.openDoorNote()
      return tds
    }
    if (key === 'notepad') return new Notepad()
    if (key === 'computer') {
      return new Explorer(this.sound, () => this.explorerFiles(), (file) => this.openDeskFile(file))
    }
    if (key === 'image') return new ImageViewer('dodry.jpg')
    if (key === 'music') return new MusicPlayer(this.sound)
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
    if (key === 'notepad' && this.pendingNote && app instanceof Notepad) {
      app.setContent(this.pendingNote.name, this.pendingNote.text)
      this.pendingNote = null
    }
    if (key === 'image' && this.pendingImage && app instanceof ImageViewer) {
      app.show(this.pendingImage)
      this.pendingImage = null
    }
    const s = SIZES[key] ?? { x: 260, y: 160, w: 340, h: 200 }
    const max = MAX_ON_OPEN.has(key)
    this.windows.push({
      key,
      app,
      x: max ? 0 : s.x,
      y: max ? 0 : s.y,
      w: max ? DESKTOP_W : s.w,
      h: max ? DESKTOP_H - TASKBAR : s.h,
      z: ++this.zTop,
      min: false,
      max,
      restore: max ? { ...s } : null,
    })
    this.dirty = true
    this.sound.open()
  }

  private close(win: Win): void {
    this.windows = this.windows.filter((w) => w !== win)
    if (win.app instanceof Tds) win.app.reset()
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
    // длинное имя не должно дотягиваться до кнопок свернуть/развернуть/закрыть
    text(
      ctx,
      ellipsis(ctx, win.app.title, bar.w - 54 - 12, 12, true),
      bar.x + 5,
      bar.y + 8.5,
      { size: 12, bold: true, color: C.titleText },
    )
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

    // грип ресайза в правом нижнем углу
    if (!win.max) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath()
        ctx.moveTo(win.x + win.w - i * 5, win.y + win.h - 3)
        ctx.lineTo(win.x + win.w - 3, win.y + win.h - i * 5)
        ctx.stroke()
      }
    }
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

  // ── файл из письма ───────────────────────────────────────────────

  /**
   * Вложение скачивается: прогресс загрузки файла, и только когда файл
   * «докачался» — на экран лезет вирус-тыква, растворяется и ставится.
   */
  private beginInstall(): void {
    if (this.install || this.icons.some((i) => i.id === 'tds')) return
    const now = performance.now()
    const dlEnd = now + 3200
    const holdEnd = dlEnd + 1400
    const fadeEnd = holdEnd + 1800
    this.install = { start: now, dlEnd, holdEnd, fadeEnd, end: fadeEnd + 2200 }
    this.sound.busy()
    this.dirty = true
  }

  private firstFreeCell(): { x: number; y: number } {
    const { cols, rows } = this.gridMax()
    const taken = new Set<string>()
    for (const icon of this.icons) {
      const c = this.nearestCell(icon.x + ICON_W / 2, icon.y + ICON_H / 2)
      taken.add(this.cellKey(c.col, c.row))
    }
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        if (!taken.has(this.cellKey(col, row))) {
          return { x: 10 + col * 94, y: 8 + row * 94 }
        }
      }
    }
    return { x: 10, y: 8 }
  }

  /** После установки на стол ложится один ярлык — tds.exe. */
  private dropPayload(): void {
    if (this.icons.some((i) => i.id === 'tds')) return
    const cell = this.firstFreeCell()
    this.icons.push({
      id: 'tds',
      label: 'tds.exe',
      glyph: 'virus',
      app: 'tds',
      x: cell.x,
      y: cell.y,
    })
  }

  private drawInstall(): void {
    if (!this.install) return
    const now = performance.now()
    if (now < this.install.dlEnd) {
      this.drawDownload(now)
      return
    }
    if (now < this.install.fadeEnd) {
      this.drawVirus(now)
      return
    }

    const ctx = this.ctx
    const span = this.install.end - this.install.fadeEnd
    const p = clamp((now - this.install.fadeEnd) / span, 0, 1)

    const r: Rect = { x: (DESKTOP_W - 380) / 2, y: (DESKTOP_H - TASKBAR - 176) / 2, w: 380, h: 176 }
    panel(ctx, r, true, 2)

    const bar: Rect = { x: r.x + 3, y: r.y + 3, w: r.w - 6, h: 16 }
    const g = ctx.createLinearGradient(bar.x, bar.y, bar.x, bar.y + bar.h)
    g.addColorStop(0, C.titleOn2)
    g.addColorStop(1, C.titleOn)
    ctx.fillStyle = g
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h)
    text(ctx, 'Установка TDS', bar.x + 5, bar.y + 8.5, { size: 12, bold: true, color: C.titleText })

    const x = r.x + 18
    let y = r.y + 34
    text(ctx, 'tds.exe · терминал наблюдения', x, y, { size: 12, bold: true })
    y += 18
    text(ctx, 'После установки ярлык появится на рабочем столе.', x, y, {
      size: 11,
      color: C.textDim,
    })

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

  /** Диалог скачивания: полоса прогресса, пока файл «качается» с узла. */
  private drawDownload(now: number): void {
    const inst = this.install!
    const ctx = this.ctx
    const p = clamp((now - inst.start) / (inst.dlEnd - inst.start), 0, 1)

    const r: Rect = { x: (DESKTOP_W - 380) / 2, y: (DESKTOP_H - TASKBAR - 156) / 2, w: 380, h: 150 }
    panel(ctx, r, true, 2)
    const bar: Rect = { x: r.x + 3, y: r.y + 3, w: r.w - 6, h: 16 }
    const g = ctx.createLinearGradient(bar.x, bar.y, bar.x, bar.y + bar.h)
    g.addColorStop(0, C.titleOn2)
    g.addColorStop(1, C.titleOn)
    ctx.fillStyle = g
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h)
    text(ctx, 'Загрузка файла', bar.x + 5, bar.y + 8.5, { size: 12, bold: true, color: C.titleText })

    const x = r.x + 18
    let y = r.y + 34
    text(ctx, 'cam04-archive.zip с intranet.local', x, y, { size: 12, bold: true })
    y += 18
    text(ctx, 'Не закрывайте окно: файл ставится на рабочий стол.', x, y, {
      size: 11,
      color: C.textDim,
    })

    const track: Rect = { x, y: y + 16, w: r.w - 36, h: 20 }
    panel(ctx, track, false, 2)
    const inner: Rect = { x: track.x + 2, y: track.y + 2, w: track.w - 4, h: track.h - 4 }
    fill(ctx, inner, '#8e8e86')
    const done: Rect = { ...inner, w: Math.round(inner.w * p) }
    fill(ctx, done, '#2c4f86')
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
    for (let sx = inner.x + 12; sx < inner.x + inner.w; sx += 12) ctx.fillRect(sx, inner.y, 1, inner.h)

    const kb = Math.round(2400 * p)
    text(ctx, `${Math.round(p * 100)}% · ${kb} КБ из 2 400`, x, track.y + track.h + 14, {
      size: 11,
      color: C.textDim,
    })
    text(ctx, 'Скорость: 33,6 Кбит/с', r.x + r.w - 18, track.y + track.h + 14, {
      size: 11,
      color: C.textDim,
      align: 'right',
    })
  }

  /**
   * Вирус-тыква во весь экран: оранжевая тыква с вирусными шипами и злой
   * ухмылкой. Держится, потом медленно тает — игрок понимает, что натворил.
   */
  private drawVirus(now: number): void {
    const inst = this.install!
    const ctx = this.ctx
    const fade = now <= inst.holdEnd ? 1 : 1 - (now - inst.holdEnd) / (inst.fadeEnd - inst.holdEnd)
    const a = clamp(fade, 0, 1)
    const cx = DESKTOP_W / 2
    const cy = DESKTOP_H / 2 - 26

    ctx.save()
    ctx.globalAlpha = a

    fill(ctx, { x: 0, y: 0, w: DESKTOP_W, h: DESKTOP_H }, '#070503')
    const glow = ctx.createRadialGradient(cx, cy, 40, cx, cy, 330)
    glow.addColorStop(0, 'rgba(120, 58, 12, 0.55)')
    glow.addColorStop(0.55, 'rgba(52, 22, 6, 0.35)')
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, DESKTOP_W, DESKTOP_H)

    const pulse = 1 + Math.sin(now / 260) * 0.015
    const R = 128 * pulse

    // вирусные шипы с шариками на концах
    ctx.strokeStyle = '#5f9e3c'
    ctx.fillStyle = '#4c8830'
    ctx.lineWidth = 9
    ctx.lineCap = 'round'
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + Math.sin(i * 7) * 0.05
      const x0 = cx + Math.cos(ang) * (R + 2)
      const y0 = cy + Math.sin(ang) * (R + 2)
      const x1 = cx + Math.cos(ang) * (R + 30)
      const y1 = cy + Math.sin(ang) * (R + 30)
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x1, y1, 7, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.lineWidth = 1

    // тыква: тело, рёбра, блик
    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.2, cx, cy, R)
    body.addColorStop(0, '#f0902c')
    body.addColorStop(0.6, '#d8721c')
    body.addColorStop(1, '#8f3f0c')
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.ellipse(cx, cy, R, R * 0.96, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(90, 34, 6, 0.55)'
    ctx.lineWidth = 5
    for (const k of [-0.62, -0.3, 0.3, 0.62]) {
      ctx.beginPath()
      ctx.ellipse(cx + R * k * 0.55, cy, R * 0.3, R * 0.93, 0, 0, Math.PI * 2)
      ctx.stroke()
    }

    // черенок
    ctx.fillStyle = '#4f7a2c'
    ctx.beginPath()
    ctx.moveTo(cx - 12, cy - R + 6)
    ctx.lineTo(cx - 4, cy - R - 30)
    ctx.lineTo(cx + 8, cy - R - 26)
    ctx.lineTo(cx + 6, cy - R + 8)
    ctx.closePath()
    ctx.fill()

    // злые треугольные глаза
    ctx.fillStyle = '#1c0d04'
    for (const sx of [-1, 1]) {
      const ex = cx + sx * R * 0.38
      ctx.beginPath()
      ctx.moveTo(ex - 26, cy - 44)
      ctx.lineTo(ex + 24, cy - 26)
      ctx.lineTo(ex - 18, cy - 4)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(255, 210, 120, 0.85)'
      ctx.beginPath()
      ctx.arc(ex + 2, cy - 24, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#1c0d04'
    }

    // ухмылка: зигзаг с зубами
    ctx.strokeStyle = '#1c0d04'
    ctx.lineWidth = 8
    ctx.beginPath()
    const mouthY = cy + R * 0.34
    ctx.moveTo(cx - R * 0.5, mouthY)
    for (let i = 0; i <= 6; i++) {
      const x = cx - R * 0.5 + (i / 6) * R
      ctx.lineTo(x, mouthY + (i % 2 === 0 ? 16 : -2))
    }
    ctx.stroke()
    ctx.lineWidth = 1

    // подпись
    ctx.font = 'bold 22px "Courier New", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(120, 190, 95, 0.9)'
    ctx.fillText('T D S . E X E', cx, cy + R + 78)
    ctx.font = '12px "Courier New", monospace'
    ctx.fillStyle = 'rgba(120, 150, 110, 0.75)'
    ctx.fillText('не выключайте компьютер', cx, cy + R + 104)
    ctx.textAlign = 'left'
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
      // длинный заголовок не должен налезать на соседнюю кнопку — многоточие
      const bold = win === active && !win.min
      text(ctx, ellipsis(ctx, win.app.title, r.w - 14, 12, bold), r.x + 7, r.y + 11, {
        size: 12,
        bold,
        color: win.min ? C.textDim : C.text,
      })
      x += 151
    }

    // звук: динамик слева от часов, щелчок открывает ползунок громкости
    const volume = this.volumeIcon()
    panel(ctx, volume, !this.volumeOpen, 2)
    this.drawSpeaker(volume, this.sound.volume)

    const clock: Rect = { x: DESKTOP_W - 62, y: top + 3, w: 58, h: 23 }
    panel(ctx, clock, false, 2)
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    text(ctx, `${hh}:${mm}`, clock.x + clock.w / 2, clock.y + 11, { size: 12, align: 'center' })
  }

  private volumeIcon(): Rect {
    return { x: DESKTOP_W - 90, y: DESKTOP_H - TASKBAR + 3, w: 26, h: 23 }
  }

  private volumePopup(): Rect {
    return { x: DESKTOP_W - 152, y: DESKTOP_H - TASKBAR - 146, w: 78, h: 138 }
  }

  /** Желобок ползунка: по нему считается громкость, 1 — сверху. */
  private volumeTrack(): Rect {
    const p = this.volumePopup()
    return { x: p.x + 31, y: p.y + 24, w: 16, h: 84 }
  }

  private drawVolume(): void {
    const ctx = this.ctx
    const p = this.volumePopup()
    panel(ctx, p, true, 2)
    text(ctx, 'Звук', p.x + p.w / 2, p.y + 11, { size: 11, bold: true, align: 'center' })

    const tr = this.volumeTrack()
    panel(ctx, tr, false, 1)
    fill(ctx, { x: tr.x + 2, y: tr.y + 2, w: tr.w - 4, h: tr.h - 4 }, C.faceHi)
    // заливка снизу: видно, сколько громкости накручено
    const level = this.sound.volume
    const top = tr.y + 2 + (tr.h - 4) * (1 - level)
    fill(ctx, { x: tr.x + 2, y: top, w: tr.w - 4, h: tr.y + tr.h - 2 - top }, C.titleOn2)
    ctx.strokeStyle = C.faceLo
    ctx.lineWidth = 1
    for (const f of [0.25, 0.5, 0.75]) {
      const y = Math.round(tr.y + 2 + (tr.h - 4) * f) + 0.5
      ctx.beginPath()
      ctx.moveTo(tr.x + 3, y)
      ctx.lineTo(tr.x + 6, y)
      ctx.moveTo(tr.x + tr.w - 6, y)
      ctx.lineTo(tr.x + tr.w - 3, y)
      ctx.stroke()
    }
    // ползунок
    panel(ctx, { x: tr.x - 1, y: Math.round(top) - 4, w: tr.w + 2, h: 9 }, true, 1)
    text(ctx, `${Math.round(level * 100)}%`, p.x + p.w / 2, tr.y + tr.h + 14, {
      size: 11,
      align: 'center',
    })
  }

  /** Динамик: корпус, раструб и волны; на нуле — крестик. */
  private drawSpeaker(r: Rect, level: number): void {
    const ctx = this.ctx
    const cx = r.x + 5
    const cy = r.y + r.h / 2
    ctx.fillStyle = C.text
    ctx.beginPath()
    ctx.moveTo(cx, cy - 3)
    ctx.lineTo(cx + 4, cy - 3)
    ctx.lineTo(cx + 8, cy - 8)
    ctx.lineTo(cx + 8, cy + 8)
    ctx.lineTo(cx + 4, cy + 3)
    ctx.lineTo(cx, cy + 3)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = C.text
    ctx.lineWidth = 1.5
    const waves = level > 0.55 ? 2 : level > 0.05 ? 1 : 0
    for (let i = 1; i <= waves; i++) {
      ctx.beginPath()
      ctx.arc(cx + 8, cy, 2.5 + i * 3, -0.85, 0.85)
      ctx.stroke()
    }
    if (!waves) {
      ctx.beginPath()
      ctx.moveTo(cx + 12, cy - 4)
      ctx.lineTo(cx + 18, cy + 4)
      ctx.moveTo(cx + 18, cy - 4)
      ctx.lineTo(cx + 12, cy + 4)
      ctx.stroke()
    }
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

  /** Письмо от похитителей приходит при первом открытии страницы камеры. */
  private deliverThreat(): void {
    this.getMail().deliverThreat()
    this.hasNewMail = true
    this.toast = { end: performance.now() + 12000, kind: 'mail' }
    this.sound.message()
    this.dirty = true
  }

  private triggerThreat(): void {
    if (this.threatSent) return
    this.threatSent = true
    this.deliverThreat()
  }

  /** Игрок прочитал письмо — замок камеры разблокирован. */
  private grantCamera(): void {
    this.cameraAccess = true
    const tds = this.cache.get('tds')
    if (tds instanceof Tds) tds.setAccess(true)
    this.dirty = true
  }

  // ── сброс замка двери ────────────────────────────────────────────

  /**
   * Нажата «Открыть дверь» в терминале. Замок заражен, поэтому терминал не
   * отпирает дверь, а выдаёт адрес панели сброса: блокнот с адресом и файл
   * дверь.txt в Загрузках и Документах. Повторные нажатия просто открывают
   * блокнот снова.
   */
  private openDoorNote(): void {
    if (!this.unlockNoteSent) {
      this.unlockNoteSent = true
      this.dirty = true
    }
    this.openNotepadWith('дверь.txt', DOOR_NOTE)
  }

  /** Открыть блокнот с готовым текстом: существующее окно или новое. */
  private openNotepadWith(name: string, body: string): void {
    const existing = this.windows.find((w) => w.key === 'notepad')
    if (existing) {
      if (existing.app instanceof Notepad) existing.app.setContent(name, body)
      existing.min = false
      this.raise(existing)
      this.sound.open()
      this.dirty = true
      return
    }
    this.pendingNote = { name, text: body }
    this.open('notepad')
  }

  /** Файл открыт из проводника: текст — в блокнот, картинку — в просмотр. */
  private openDeskFile(file: DeskFile): void {
    if (file.kind === 'txt') this.openNotepadWith(file.name, DOOR_NOTE)
    else if (file.kind === 'image') {
      this.pendingImage = file.name
      this.open('image')
    } else if (file.kind === 'audio') {
      // пасхалка: мгновенно открываем проигрыватель (грузится и играет в нём)
      this.open('music')
    } else this.open('tds')
  }

  /** Содержимое папок «Мой компьютер»: растёт по ходу игры. */
  private explorerFiles(): DeskFile[] {
    const files: DeskFile[] = [
      { folder: 'Музыка', name: 'песенка для малыша.ogg', kind: 'audio' },
      { folder: 'Изображения', name: 'dodry.jpg', kind: 'image' },
      { folder: 'Изображения', name: 'avizero.jpg', kind: 'image' },
      { folder: 'Изображения', name: 'Иларион.jpg', kind: 'image' },
    ]
    if (this.icons.some((i) => i.id === 'tds')) {
      files.push({ folder: 'Загрузки', name: 'tds.exe', kind: 'exe' })
    }
    if (this.unlockNoteSent) {
      files.push({ folder: 'Загрузки', name: 'дверь.txt', kind: 'txt' })
      files.push({ folder: 'Документы', name: 'дверь.txt', kind: 'txt' })
    }
    return files
  }

  /** Мини-игра на lockreset.local сняла блокировку: дверь отпирается. */
  private unlockDoor(): void {
    if (this.doorUnlocked) return
    this.doorUnlocked = true
    for (const app of this.cache.values()) {
      if (app instanceof Tds) app.doorOpened()
    }
    this.dirty = true
  }

  /** Состояние сценария замка — для проверок из tools/. */
  debugInfo(): {
    unlockNote: boolean
    door: boolean
    files: DeskFile[]
    printedCode: string | null
    pairsLost: boolean
  } {
    return {
      unlockNote: this.unlockNoteSent,
      door: this.doorUnlocked,
      files: this.explorerFiles(),
      printedCode: this.printedCode,
      pairsLost: this.pairsLostFlag,
    }
  }

  /** Сайт пар напечатал бумажку: код уходит на принтер в кухне. */
  private printCode(code: string): void {
    this.printedCode = code
    getCctv().print(code)
    this.dirty = true
  }

  /**
   * Перехват провален: кино на всей сцене. Сразу — плашка «Мне очень
   * жаль» на странице игры и мурзик, который за весь путь маньяка громчает
   * до предела; через пару секунд — бросок на камеру 05 и её лок.
   */
  private pairsLost(): void {
    this.pairsLostFlag = true
    this.cinematic = true
    // мурзик громчает ровно до «за секунду до касания»
    this.sound.playMurzikDread(2200 + (WALK_S - 1) * 1000)
    window.setTimeout(() => {
      this.throwToCamera()
      getCctv().maniacAttack()
      this.dirty = true
    }, 2200)
    this.dirty = true
  }

  /** Кино провала: зритель смотрит камеру 05, окно терминала залочено. */
  private throwToCamera(): void {
    const tds = this.cache.get('tds')
    if (tds instanceof Tds) {
      tds.forceChannel('05')
      const win = this.windows.find((w) => w.app === tds)
      if (win) {
        win.min = false
        this.raise(win)
      } else this.open('tds')
    } else {
      // терминал ещё не ставился — открываем отладкой, гейты уже не важны
      this.debugOpenCamera()
    }
  }

  /** Она сказала что-то важное: блокнот-заметки открывается с новой строкой. */
  private appendNote(line: string): void {
    if (!this.noteText) this.noteText = 'ЗАМЕТКИ ОПЕРАТОРА\n-----------------'
    const now = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    this.noteText += `\n${p(now.getHours())}:${p(now.getMinutes())} — ${line}`
    this.openNotepadWith('заметки.txt', this.noteText)
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
    text(ctx, this.toast.kind === 'file' ? 'Файл' : 'Почта', bar.x + 5, bar.y + 8.5, {
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
      drawIcon(ctx, 'virus', r.x + 28, r.y + 44, 1)
      text(ctx, 'Установлено', r.x + 50, r.y + 32, { size: 12, bold: true })
      text(ctx, 'На рабочем столе: tds.exe', r.x + 50, r.y + 50, { size: 11, color: C.alert })
      text(ctx, 'Запустите ярлык терминала', r.x + 50, r.y + 68, {
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
    text(ctx, 'Вложение: tds.exe', r.x + 50, r.y + 50, { size: 11, color: C.alert })
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

  /** Потянуть за край окна: правый, нижний или угол. */
  private resizing: {
    win: Win
    edge: 'e' | 's' | 'se'
    x: number
    y: number
    w: number
    h: number
  } | null = null

  pointerDown(x: number, y: number, shift = false): void {
    this.pointer.x = x
    this.pointer.y = y
    this.pointer.over = true
    this.clickOpen = null

    // Конец демо или смерть: любой клик перезапускает смену.
    if (this.girlDead || this.escaped) {
      location.reload()
      return
    }

    // Кино провала ведёт сцена: пока не погас экран, клики не работают.
    if (this.cinematic) return

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

    if (this.volumeOpen) {
      const pop = this.volumePopup()
      if (inside(pop, x, y)) {
        this.volumeDrag = true
        this.setVolumeAt(y)
        return
      }
      this.volumeOpen = false
      this.dirty = true
    }

    if (y >= DESKTOP_H - TASKBAR) {
      this.clearSelection()
      if (inside(this.volumeIcon(), x, y)) {
        this.volumeOpen = !this.volumeOpen
        this.sound.click()
        this.dirty = true
        return
      }
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

      if (!win.max) {
        const edge = this.resizeEdge(win, x, y)
        if (edge) {
          this.clearSelection()
          this.raise(win)
          this.resizing = { win, edge, x, y, w: win.w, h: win.h }
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
        if (win.app.drag) this.appDrag = win
        this.dirty = true
        return
      }
    }

    // Ярлыки: клик выделяет, двойной клик открывает, перетаскивание двигает.
    for (let i = this.icons.length - 1; i >= 0; i--) {
      const icon = this.icons[i]
      if (!inside(this.iconRect(icon), x, y)) continue

      const now = performance.now()
      if (!shift && this.lastClick.id === icon.id && now - this.lastClick.at < 450) {
        // Не открываем сразу: если игрок начнёт тащить, это не двойной щелчок.
        this.lastClick = { id: '', at: 0 }
        this.clickOpen = { app: icon.app }
      } else {
        this.lastClick = shift ? { id: '', at: 0 } : { id: icon.id, at: now }
      }

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
        anchorId: icon.id,
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

    if (this.volumeDrag) {
      this.setVolumeAt(y)
      return
    }

    if (this.appDrag) {
      this.appDrag.app.drag?.(x, y, this.contentRect(this.appDrag))
      this.dirty = true
      return
    }

    if (this.band) {
      this.band.x1 = x
      this.band.y1 = y
      this.updateBand()
      return
    }

    if (this.resizing) {
      const r = this.resizing
      if (r.edge !== 's') r.win.w = clamp(r.w + x - r.x, 320, DESKTOP_W - r.win.x)
      if (r.edge !== 'e') r.win.h = clamp(r.h + y - r.y, 220, DESKTOP_H - TASKBAR - r.win.y)
      this.dirty = true
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

  /** Точка клика по ползунку → громкость; за пределами желобка — крайние. */
  private setVolumeAt(y: number): void {
    const tr = this.volumeTrack()
    const v = 1 - (y - (tr.y + 2)) / (tr.h - 4)
    const next = Math.min(1, Math.max(0, v))
    if (Math.abs(next - this.sound.volume) > 0.001) {
      this.sound.setVolume(next)
      this.dirty = true
    }
  }

  /** Мышь ушла с экрана монитора — курсор на столе больше не рисуем. */
  pointerOut(): void {
    if (!this.pointer.over) return
    this.pointer.over = false
    this.dirty = true
  }

  pointerUp(): void {
    this.volumeDrag = false
    if (this.appDrag) {
      this.appDrag.app.release?.()
      this.appDrag = null
      this.dirty = true
    }
    const openApp = this.clickOpen && !(this.iconDrag?.moved ?? false) ? this.clickOpen.app : null
    if (this.iconDrag?.moved) this.snapIcons(this.iconDrag.ids)
    this.drag = null
    this.iconDrag = null
    this.clickOpen = null
    this.resizing = null
    if (this.band) {
      this.band = null
      this.dirty = true
    }
    if (openApp) this.open(openApp)
  }

  // ── сетка ярлыков ────────────────────────────────────────────────

  private gridMax(): { cols: number; rows: number } {
    return {
      cols: Math.floor((DESKTOP_W - 10) / 94),
      rows: Math.floor((DESKTOP_H - TASKBAR - 8) / 94),
    }
  }

  /** Ячейка сетки, в которую попадает центр ярлыка. */
  private nearestCell(x: number, y: number): { col: number; row: number } {
    const { cols, rows } = this.gridMax()
    return {
      col: clamp(Math.round((x - 10 - ICON_W / 2) / 94), 0, cols - 1),
      row: clamp(Math.round((y - 8 - ICON_H / 2) / 94), 0, rows - 1),
    }
  }

  private cellKey(col: number, row: number): string {
    return `${col}:${row}`
  }

  /** Ближайшая свободная ячейка: поиск по кольцам, внутри кольца — по расстоянию. */
  private nearestFreeCell(col: number, row: number, taken: Set<string>): { col: number; row: number } {
    const { cols, rows } = this.gridMax()
    for (let ring = 0; ring < cols + rows; ring++) {
      let best: { col: number; row: number; d: number } | null = null
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue
          const c = col + dc
          const r = row + dr
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue
          if (taken.has(this.cellKey(c, r))) continue
          const d = dc * dc + dr * dr
          if (!best || d < best.d) best = { col: c, row: r, d }
        }
      }
      if (best) return { col: best.col, row: best.row }
    }
    return { col: clamp(col, 0, cols - 1), row: clamp(row, 0, rows - 1) }
  }

  /** Прижать перетащенные ярлыки к сетке; в занятую ячейку не ставить. */
  private snapIcons(ids: string[]): void {
    const { cols, rows } = this.gridMax()
    const dragged = this.icons.filter((i) => ids.includes(i.id))
    if (dragged.length === 0) return

    // Все неперетаскиваемые ярлыки занимают свои ячейки.
    const taken = new Set<string>()
    for (const icon of this.icons) {
      if (ids.includes(icon.id)) continue
      const c = this.nearestCell(icon.x + ICON_W / 2, icon.y + ICON_H / 2)
      taken.add(this.cellKey(c.col, c.row))
    }

    // Сдвиг группы считаем по ярлыку, за который взялись мышью: так
    // взаимное расположение нескольких выделенных ярлыков не разъезжается.
    const drag = this.iconDrag
    const anchor = dragged.find((i) => i.id === drag?.anchorId) ?? dragged[0]
    const anchorOrig = drag?.orig.get(anchor.id) ?? { x: anchor.x, y: anchor.y }
    const anchorFrom = this.nearestCell(anchorOrig.x + ICON_W / 2, anchorOrig.y + ICON_H / 2)
    const anchorTo = this.nearestCell(anchor.x + ICON_W / 2, anchor.y + ICON_H / 2)
    const dCol = anchorTo.col - anchorFrom.col
    const dRow = anchorTo.row - anchorFrom.row

    const sorted = [...dragged].sort((a, b) => {
      const ca = this.nearestCell(a.x + ICON_W / 2, a.y + ICON_H / 2)
      const cb = this.nearestCell(b.x + ICON_W / 2, b.y + ICON_H / 2)
      return ca.row - cb.row || ca.col - cb.col
    })

    for (const icon of sorted) {
      const orig = drag?.orig.get(icon.id) ?? { x: icon.x, y: icon.y }
      const from = this.nearestCell(orig.x + ICON_W / 2, orig.y + ICON_H / 2)
      const want = {
        col: clamp(from.col + dCol, 0, cols - 1),
        row: clamp(from.row + dRow, 0, rows - 1),
      }
      const free = taken.has(this.cellKey(want.col, want.row))
        ? this.nearestFreeCell(want.col, want.row, taken)
        : want
      taken.add(this.cellKey(free.col, free.row))
      icon.x = 10 + free.col * 94
      icon.y = 8 + free.row * 94
    }
    this.dirty = true
  }

  isDragging(): boolean {
    return (
      this.drag !== null ||
      (this.iconDrag?.moved ?? false) ||
      this.band !== null ||
      this.resizing !== null
    )
  }

  /** Какой край окна под курсором: правый, нижний, угол — или null. */
  private resizeEdge(win: Win, x: number, y: number): 'e' | 's' | 'se' | null {
    const nearE = x >= win.x + win.w - 6 && x <= win.x + win.w + 2 && y >= win.y + 20 && y <= win.y + win.h + 2
    const nearS = y >= win.y + win.h - 6 && y <= win.y + win.h + 2 && x >= win.x + 20 && x <= win.x + win.w + 2
    if (nearE && nearS) return 'se'
    if (nearE) return 'e'
    if (nearS) return 's'
    return null
  }

  /** Идёт «загрузка» программы или установка файла: на экране нужны песочные часы. */
  isBusy(): boolean {
    return this.pending !== null || this.install !== null
  }

  /** Отладка для tools/: открыть TDS сразу с живым кадром, без письма и вируса. */
  debugOpenCamera(): void {
    // отладка = вся история уже прошла: гейты игровых узлов тоже открыты
    this.cameraAccess = true
    const app = new Tds(this.sound)
    app.setAccess(true)
    app.onDoorRequest = () => this.openDoorNote()
    if (this.doorUnlocked) app.doorOpened()
    this.cache.set('tds', app)
    this.spawn('tds')
    app.debugOpen()
  }
}
