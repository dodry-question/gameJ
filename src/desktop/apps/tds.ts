/**
 * TDS — терминал наблюдения, единственная программа для камер.
 *
 * Открывается сразу на плане блока C. Чтобы войти в камеру, узел держат
 * зажатой две секунды: кольцо вокруг узла заполняется, затем идёт экран
 * подключения, и только потом проявляется картинка.
 */
import { C, bevel, fill, inside, panel, setFont, text } from '../draw'
import type { Rect } from '../draw'
import type { App } from '../app'
import type { Sound } from '../../audio'
import { getCctv } from '../../cctv'
import { CameraFeed } from './camera'
import { TdsMap } from './tds-map'
import type { HoldState } from './tds-map'

const HEAD = 46
const HOLD_MS = 700
const CONNECT_MS = 600
const TIP_MS = 2600

type Screen = 'map' | 'loading' | 'feed'

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export class Tds implements App {
  title = 'TDS · терминал наблюдения'
  /** Первый живой кадр: сценарий присылает письмо похитителей. */
  onFirstView?: () => void
  /** Нажата «Открыть дверь»: терминал отдаёт адрес панели сброса. */
  onDoorRequest?: () => void

  private screen: Screen = 'map'
  private map = new TdsMap()
  private feed: CameraFeed
  private sound: Sound
  private hold: { id: string; start: number; x: number; y: number } | null = null
  /** Отпустил узел раньше конца: достигнутое держится секунду и вернётся. */
  private resumeHold: { id: string; progress: number; until: number } | null = null
  private connectAt = 0
  private message = ''
  private messageUntil = 0
  private firstViewed = false
  private backRect: Rect | null = null

  constructor(sound: Sound) {
    this.sound = sound
    this.feed = new CameraFeed(sound)
    this.feed.onUnlock = () => this.onDoorRequest?.()
    ;(window as unknown as { __tds?: Tds }).__tds = this
  }

  /** Доступ к замку открывается после прочтения письма. */
  setAccess(allowed: boolean): void {
    this.feed.setAccess(allowed)
  }

  /** Замок снят в панели сброса: дверь отпирается (девушка выбегает). */
  doorOpened(): void {
    this.feed.unlock()
  }

  /** Виден ли сейчас прямой эфир — по этому включаются звуки камеры. */
  get viewingCamera(): boolean {
    return this.screen === 'feed'
  }

  /** Вернуться на карту: вызывается при закрытии окна и кнопкой «Карта». */
  reset(): void {
    this.screen = 'map'
    this.hold = null
    this.feed.stop()
  }

  /** Отладочный вход без удержания и установки: для инструментов проверки. */
  debugOpen(): void {
    this.screen = 'feed'
    this.firstViewed = true
    this.feed.startNow()
  }

  /** Кино провала: рабочий стол силой открывает эфир нужного канала. */
  forceChannel(ch: '04' | '05'): void {
    this.screen = 'feed'
    this.firstViewed = true
    this.feed.setChannel(ch)
    this.feed.startNow()
  }

  /** Состояние экрана и точки узлов — для проверок из tools/. */
  debugInfo(): {
    screen: Screen
    cam: { x: number; y: number } | null
    cam05: { x: number; y: number } | null
    door: boolean
  } {
    return {
      screen: this.screen,
      cam: this.map.point('04'),
      cam05: this.map.point('05'),
      door: this.feed.releasedGirl,
    }
  }

  tick(): boolean {
    const cctv = getCctv()
    cctv.update()
    const now = performance.now()

    if (this.screen === 'loading' && now >= this.connectAt) {
      this.screen = 'feed'
      this.feed.start()
      this.sound.open()
      if (!this.firstViewed) {
        this.firstViewed = true
        this.onFirstView?.()
      }
    }

    this.feed.tick(this.screen === 'feed')
    if (this.screen === 'map') this.map.tick()

    // удержание доходит до конца само, отпускать мышь не обязательно
    if (this.hold && this.screen === 'map' && now - this.hold.start >= HOLD_MS) {
      this.beginConnect()
    }

    if (this.message && now >= this.messageUntil) this.message = ''
    return true
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.face)
    const area: Rect = { x: r.x + 4, y: r.y + HEAD + 2, w: r.w - 8, h: r.h - HEAD - 6 }
    this.backRect = null
    this.drawHeader(ctx, r)

    if (this.screen === 'map') {
      const hold: HoldState | null = this.hold
        ? {
            id: this.hold.id,
            p: clamp((performance.now() - this.hold.start) / HOLD_MS, 0, 1),
          }
        : null
      this.map.draw(ctx, area, hold, this.message || null)
    } else if (this.screen === 'loading') {
      this.drawConnect(ctx, area)
    } else {
      this.feed.draw(ctx, area)
    }
  }

  click(x: number, y: number, r: Rect): void {
    if (this.backRect && inside(this.backRect, x, y)) {
      this.backToMap()
      return
    }
    if (this.screen === 'feed') {
      this.feed.click(x, y, this.area(r))
      return
    }
    if (this.screen !== 'map') return

    const cam = this.map.hit(x, y)
    if (!cam) return
    if (!this.map.isOnline(cam)) {
      this.say(`КАМЕРА ${cam.id} · НЕТ СВЯЗИ`)
      this.sound.error()
      return
    }
    const now = performance.now()
    const rh = this.resumeHold
    // микрофальт не сбрасывает удержание: достигнутое вернулось вместе с мышью
    if (rh && rh.id === cam.id && now <= rh.until) {
      this.hold = { id: cam.id, start: now - rh.progress * HOLD_MS, x, y }
      this.resumeHold = null
      this.sound.click()
      return
    }
    this.hold = { id: cam.id, start: now, x, y }
    this.sound.click()
  }

  /** Протяжка отменяет удержание: игрок повёл мышь, а не держит узел. */
  drag(x: number, y: number): void {
    if (!this.hold) return
    if (Math.hypot(x - this.hold.x, y - this.hold.y) > 10) {
      this.hold = null
      this.say('УДЕРЖИВАЙТЕ КАМЕРУ, НЕ ДВИГАЯ МЫШЬ')
    }
  }

  release(): void {
    if (!this.hold) return
    const progress = Math.min(1, (performance.now() - this.hold.start) / HOLD_MS)
    this.resumeHold =
      progress >= 0.2 ? { id: this.hold.id, progress, until: performance.now() + 1000 } : null
    this.hold = null
    this.say('УДЕРЖИВАЙТЕ КАМЕРУ')
  }

  /** Клавиша активному окну: TAB на кухне включает скан объектов. */
  key(e: KeyboardEvent): boolean {
    if (this.screen !== 'feed') return false
    return this.feed.key(e)
  }

  private area(r: Rect): Rect {
    return { x: r.x + 4, y: r.y + HEAD + 2, w: r.w - 8, h: r.h - HEAD - 6 }
  }

  private beginConnect(): void {
    // канал выбирается по узлу, который держали: 04 — комната 4, 05 — кухня
    this.feed.setChannel((this.hold?.id as '04' | '05') ?? '04')
    this.hold = null
    this.screen = 'loading'
    this.connectAt = performance.now() + CONNECT_MS
    this.sound.busy()
  }

  private backToMap(): void {
    this.feed.stop()
    this.screen = 'map'
    this.hold = null
    this.sound.click()
  }

  private say(msg: string): void {
    this.message = msg
    this.messageUntil = performance.now() + TIP_MS
  }

  // ── шапка ────────────────────────────────────────────────────────

  private drawHeader(ctx: CanvasRenderingContext2D, r: Rect): void {
    const head: Rect = { x: r.x, y: r.y, w: r.w, h: HEAD }
    fill(ctx, head, C.face)
    ctx.strokeStyle = C.faceHi
    ctx.beginPath()
    ctx.moveTo(head.x, head.y + head.h - 1.5)
    ctx.lineTo(head.x + head.w, head.y + head.h - 1.5)
    ctx.stroke()
    ctx.strokeStyle = C.faceLo
    ctx.beginPath()
    ctx.moveTo(head.x, head.y + head.h - 0.5)
    ctx.lineTo(head.x + head.w, head.y + head.h - 0.5)
    ctx.stroke()

    let x = head.x + 12
    const cy = head.y + 17

    if (this.screen !== 'map') {
      const back: Rect = { x, y: head.y + 7, w: 84, h: 24 }
      panel(ctx, back, true, 1)
      text(ctx, '← КАРТА', back.x + back.w / 2, back.y + back.h / 2, {
        size: 11,
        bold: true,
        align: 'center',
      })
      this.backRect = back
      x = back.x + back.w + 12
    }

    // объектив — эмблема терминала
    this.lens(ctx, x + 8, cy)
    x += 22

    setFont(ctx, 14, true)
    ctx.fillStyle = C.text
    ctx.textBaseline = 'middle'
    const camId = this.feed.channelNow
    ctx.fillText(this.screen === 'map' ? 'TDS' : `КАМЕРА ${camId}`, x, cy - 2)
    setFont(ctx, 9)
    ctx.fillStyle = C.textDim
    const sub =
      this.screen === 'map'
        ? 'ТЕРМИНАЛ НАБЛЮДЕНИЯ · БЛОК C'
        : this.screen === 'loading'
          ? camId === '05'
            ? 'ПОДКЛЮЧЕНИЕ · КУХНЯ'
            : 'ПОДКЛЮЧЕНИЕ · КОМНАТА 4'
          : camId === '05'
            ? 'КОМНАТА 5 · КУХНЯ · БЛОК C'
            : 'КОМНАТА 4 · БЛОК C'
    ctx.fillText(sub, x, cy + 12)

    // справа: часы и лампа связи
    const now = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const clock: Rect = { x: head.x + head.w - 96, y: head.y + 8, w: 84, h: 22 }
    panel(ctx, clock, false, 1)
    fill(ctx, { x: clock.x + 2, y: clock.y + 2, w: clock.w - 4, h: clock.h - 4 }, '#11150f')
    setFont(ctx, 13, true)
    ctx.fillStyle = '#9fd39f'
    ctx.textAlign = 'center'
    ctx.fillText(`${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`, clock.x + clock.w / 2, clock.y + clock.h / 2 + 1)
    ctx.textAlign = 'left'

    const online = this.screen === 'feed'
    ctx.fillStyle = online ? '#2c7a2c' : '#6d6d66'
    ctx.beginPath()
    ctx.arc(head.x + head.w - 112, cy, 4, 0, Math.PI * 2)
    ctx.fill()
    setFont(ctx, 9)
    ctx.fillStyle = online ? '#2c7a2c' : C.textDim
    ctx.textAlign = 'right'
    ctx.fillText(online ? 'ЭФИР' : 'ОЖИДАНИЕ', head.x + head.w - 118, cy)
    ctx.textAlign = 'left'
    bevel(ctx, head, false, 1)
  }

  private lens(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.fillStyle = '#39414b'
    ctx.beginPath()
    ctx.arc(cx, cy, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1d2b36'
    ctx.beginPath()
    ctx.arc(cx, cy, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#9fd4e8'
    ctx.beginPath()
    ctx.arc(cx - 1.5, cy - 1.5, 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#d4402e'
    ctx.beginPath()
    ctx.arc(cx + 9, cy - 8, 2, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── подключение ──────────────────────────────────────────────────

  private drawConnect(ctx: CanvasRenderingContext2D, area: Rect): void {
    fill(ctx, area, '#0b0f0c')
    const now = performance.now()
    const p = clamp(1 - (this.connectAt - now) / CONNECT_MS, 0, 1)
    const cx = area.x + area.w / 2
    const cy = area.y + area.h * 0.42

    // кольцо и вращающиеся засечки
    ctx.strokeStyle = 'rgba(159, 211, 159, 0.2)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(cx, cy, 44, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = '#9fd39f'
    ctx.beginPath()
    ctx.arc(cx, cy, 44, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p)
    ctx.stroke()
    ctx.lineWidth = 1
    const spin = (now / 320) % (Math.PI * 2)
    for (let i = 0; i < 12; i++) {
      const a = spin + (i / 12) * Math.PI * 2
      ctx.strokeStyle = i % 3 === 0 ? '#5f8f66' : 'rgba(120, 160, 130, 0.35)'
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * 52, cy + Math.sin(a) * 52)
      ctx.lineTo(cx + Math.cos(a) * 57, cy + Math.sin(a) * 57)
      ctx.stroke()
    }

    this.lens(ctx, cx, cy)

    setFont(ctx, 15, true)
    ctx.fillStyle = '#cfe4d2'
    ctx.textAlign = 'center'
    ctx.fillText('ПОДКЛЮЧЕНИЕ К КАМЕРЕ 04', cx, cy + 78)
    setFont(ctx, 10)
    ctx.fillStyle = '#7e8c80'
    ctx.fillText('канал 192.168.0.13 · поток 320×240', cx, cy + 96)

    const bar: Rect = { x: cx - 150, y: cy + 118, w: 300, h: 10 }
    panel(ctx, bar, false, 1)
    fill(ctx, { x: bar.x + 2, y: bar.y + 2, w: bar.w - 4, h: bar.h - 4 }, '#1c241d')
    fill(
      ctx,
      { x: bar.x + 2, y: bar.y + 2, w: Math.round((bar.w - 4) * p), h: bar.h - 4 },
      '#4f8f57',
    )
    setFont(ctx, 10, true)
    ctx.fillStyle = '#9fd39f'
    ctx.fillText(`${Math.round(p * 100)}%`, cx, cy + 144)

    // журнал шагов
    const steps: Array<[number, string]> = [
      [0.05, 'запрос канала'],
      [0.3, 'рукопожатие узла'],
      [0.62, 'синхронизация потока'],
      [0.88, 'декодирование кадра'],
    ]
    const lx = area.x + 20
    let ly = area.y + area.h - 20 - steps.length * 16
    setFont(ctx, 10)
    ctx.textAlign = 'left'
    for (const [at, label] of steps) {
      const done = p >= at
      ctx.fillStyle = done ? '#8fd08f' : '#4d5750'
      ctx.fillText(`${done ? '■' : '□'} ${label}`, lx, ly)
      ly += 16
    }
  }
}
