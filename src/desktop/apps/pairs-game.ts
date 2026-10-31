/**
 * «pairs.local» — перехват потока и сайт печати пароля.
 *
 * Игра: осу-кэтч на битах. По полю падают чипы 0 и 1, квадрат-ловец ездит
 * у линии ловли (A/D или стрелки). Нужно поймать случайное число бит
 * (15–23): с каждым пойманным битом хэш-подпись в углу перегенерируется,
 * а с достижением цели она зеленеет; цель+2 ещё допустимо, третье лишнее
 * краснеет мгновенно. Дальше — не переловить:
 * успеть нажать мышью кнопку «ПАУЗА» в другом углу и кликнуть по зелёному
 * хэшу — он выдаст код выхода из 4 цифр. Перелов или пауза вне окна —
 * подпись не сходится, связь рвётся, в кухне начинается худшее. Код
 * печатается на узле print.local (класс PrintSite ниже): строка с паролем,
 * кнопка «Печать», бумажку вынесет принтер на кухне.
 *
 * Ничего не знают ни про браузер, ни про кухню: наружу только колбэки.
 */
import { fill, inside, panel, setFont, text } from '../draw'
import type { Rect } from '../draw'
import type { Sound } from '../../audio'

type State = 'intro' | 'play' | 'paused' | 'won' | 'failed'
type Bit = { x: number; y: number; v: number; bit: 0 | 1 }

const WINDOW = 2 // зелёное окно подписи: цель..цель+2, третье лишнее = красный
const TARGET_MIN = 15 // цель ловли: случайное 15–23 — сбор долгий
const TARGET_MAX = 23
const CATCHER_W = 120 // платформа ловли: длинная, но худая, как просили
const CATCHER_H = 26
const CATCHER_SPEED = 540 // px/с
const BIT = 20 // размер чипа с битом
const FALL_MIN = 320 // скорость падения, px/с
const FALL_MAX = 430
const SPAWN_MIN = 200 // пауза между битами, мс: биты летят густо
const SPAWN_MAX = 380
const FAST_CHANCE = 0.18 // часть бит летит быстрее
const GREEN_SURGE = 0.5 // в зелёном окне поток сходит с ума: спавн вдвое чаще
const TOP_H = 22
const BOTTOM_H = 78

const rand = (a: number, b: number) => a + Math.random() * (b - a)

export class PairsGame {
  /** Поток повреждён: рабочий стол запускает сцену провала. */
  onFail?: () => void
  /** Подпись принята: код выхода показан — дверь кухни его запомнит. */
  onPassword?: (code: string) => void

  private sound: Sound
  private state: State = 'intro'
  private target = 9 // случайное 7–13: столько бит нужно перехватить
  private caught = 0
  private stream = '' // двоичный хвост перехвата для строки состояния
  private hash = '···· ···· ···· ····'
  private bits: Bit[] = []
  private spawnAt = 0
  private cx = 400 // центр ловца, координаты поля
  private fw = 800 // размер поля, обновляется из draw
  private fh = 400
  private geo: { field: Rect; pause: Rect; hash: Rect } | null = null
  private held = { left: false, right: false }
  private greenWas = false
  private password = ''
  private failSent = false
  private startBtn: Rect | null = null
  private lastT = 0

  constructor(sound: Sound) {
    this.sound = sound
    this.newSession()
    // keydown доходит только через браузер (окно активно), а отпускание
    // ловим на окне всегда — чтобы ловец не залипал при уходе со страницы
    window.addEventListener('keyup', (e) => this.hold(e.code, false))
    window.addEventListener('blur', () => {
      this.held.left = false
      this.held.right = false
    })
    ;(window as unknown as { __pairs?: PairsGame }).__pairs = this
  }

  // ── состояние для tools/ ─────────────────────────────────────────

  debugState(): object {
    return {
      state: this.state,
      caught: this.caught,
      target: this.target,
      window: [this.lo, this.hi],
      green: this.green,
      catcher: Math.round(this.cx),
      hash: this.hash,
      password: this.password || null,
    }
  }

  /** Начать игру без клика (инструменты проверки). */
  debugStart(): void {
    if (this.state === 'intro') this.begin()
  }

  /** Честно догнать пойманных бит до нужного числа (инструменты проверки). */
  debugCatch(n = 1): void {
    for (let i = 0; i < n && this.state === 'play'; i++) {
      this.doCatch(Math.random() < 0.5 ? 0 : 1)
    }
  }

  /** Центры кнопки паузы и хэш-панели — инструменты кликают по ним. */
  debugButtons(): { pause: { x: number; y: number }; hash: { x: number; y: number } } | null {
    if (!this.geo) return null
    const { pause, hash } = this.geo
    return {
      pause: { x: pause.x + pause.w / 2, y: pause.y + pause.h / 2 },
      hash: { x: hash.x + hash.w / 2, y: hash.y + hash.h / 2 },
    }
  }

  /** Сколько бит сейчас в воздухе (инструменты проверки). */
  debugBits(): number {
    return this.bits.length
  }

  /** Рабочий стол перезапустил смену — сайт встаёт на начало. */
  reset(): void {
    this.newSession()
  }

  // ── жизненный цикл ───────────────────────────────────────────────

  private get lo(): number {
    return this.target
  }

  private get hi(): number {
    return this.target + WINDOW
  }

  private get green(): boolean {
    return this.caught >= this.lo && this.caught <= this.hi
  }

  private newSession(): void {
    this.state = 'intro'
    this.target = TARGET_MIN + Math.floor(Math.random() * (TARGET_MAX - TARGET_MIN + 1))
    this.caught = 0
    this.stream = ''
    this.hash = '···· ···· ···· ····'
    this.bits = []
    this.spawnAt = 0
    this.cx = this.fw / 2
    this.held.left = false
    this.held.right = false
    this.greenWas = false
    this.password = ''
    this.failSent = false
  }

  private begin(): void {
    this.state = 'play'
    this.lastT = performance.now()
    this.spawnAt = this.lastT + 500
    this.sound.click()
  }

  tick(): boolean {
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.lastT) / 1000)
    this.lastT = now
    if (this.state !== 'play') return this.state === 'paused' || this.state === 'failed'

    // ловец: A/D и стрелки, движение напрямую без инерции
    const dir = (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0)
    if (dir !== 0) {
      this.cx = Math.max(
        CATCHER_W / 2,
        Math.min(this.fw - CATCHER_W / 2, this.cx + dir * CATCHER_SPEED * dt),
      )
    }
    // спавн бит: в зелёном окне поток торопит — успей уйти от перелова
    if (now >= this.spawnAt) {
      const v = rand(FALL_MIN, FALL_MAX) * (Math.random() < FAST_CHANCE ? 1.3 : 1)
      this.bits.push({
        x: rand(BIT, this.fw - BIT),
        y: -BIT,
        v,
        bit: Math.random() < 0.5 ? 0 : 1,
      })
      this.spawnAt = now + rand(SPAWN_MIN, SPAWN_MAX) * (this.green ? GREEN_SURGE : 1)
    }
    // падение, ловля и пропуск
    const top = this.fh - CATCHER_H
    const keep: Bit[] = []
    for (const b of this.bits) {
      b.y += b.v * dt
      const inLane = Math.abs(b.x - this.cx) <= CATCHER_W / 2 + BIT / 3
      if (inLane && b.y + BIT / 2 >= top && b.y - BIT / 2 <= this.fh + 4) {
        this.doCatch(b.bit)
        if (this.state !== 'play') return true // перелов: поток повреждён
        continue
      }
      if (b.y - BIT / 2 <= this.fh) keep.push(b)
    }
    this.bits = keep
    return true
  }

  private doCatch(bit: 0 | 1): void {
    this.caught++
    this.stream = (this.stream + bit).slice(-18)
    this.regenHash()
    this.sound.cardFlip()
    if (this.green && !this.greenWas) {
      this.greenWas = true
      this.sound.cardMatch()
    }
    if (this.caught > this.hi) this.fail()
  }

  private regenHash(): void {
    const g = () =>
      Math.floor(Math.random() * 65536)
        .toString(16)
        .padStart(4, '0')
    this.hash = `${g()} ${g()} ${g()} ${g()}`
  }

  private fail(): void {
    this.state = 'failed'
    this.held.left = false
    this.held.right = false
    this.sound.pairsFail()
    if (!this.failSent) {
      this.failSent = true
      this.onFail?.()
    }
  }

  key(e: KeyboardEvent): boolean {
    if (this.state === 'intro' && e.code === 'Space' && !e.repeat) {
      this.begin()
      return true
    }
    if (this.state !== 'play') return false
    if (e.code === 'Space') return true // не даём прокрутить страницу
    return this.hold(e.code, true)
  }

  private hold(code: string, down: boolean): boolean {
    if (code === 'KeyA' || code === 'ArrowLeft') {
      this.held.left = down
      return true
    }
    if (code === 'KeyD' || code === 'ArrowRight') {
      this.held.right = down
      return true
    }
    return false
  }

  click(x: number, y: number): boolean {
    if (this.state === 'intro') {
      if (this.startBtn && inside(this.startBtn, x, y)) {
        this.begin()
        return true
      }
      return false
    }
    if (this.state === 'paused') {
      const g = this.geo
      if (g && inside(g.hash, x, y)) {
        this.state = 'won'
        this.password = String(1000 + Math.floor(Math.random() * 9000))
        this.onPassword?.(this.password)
        this.sound.stageClear()
        return true
      }
      return true // под паузой страница мертва: ждём клик по хэшу
    }
    if (this.state !== 'play') return false
    const g = this.geo
    if (g && inside(g.pause, x, y)) {
      if (this.green) {
        this.state = 'paused'
        this.held.left = false
        this.held.right = false
        this.sound.message()
      } else {
        this.fail() // коммит вне окна: подпись не сойдётся
      }
      return true
    }
    return false
  }

  // ── отрисовка ────────────────────────────────────────────────────

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, '#050d08')
    const now = performance.now()

    const field: Rect = {
      x: r.x + 8,
      y: r.y + TOP_H + 8,
      w: r.w - 16,
      h: r.h - TOP_H - BOTTOM_H - 16,
    }
    this.fw = field.w
    this.fh = field.h
    this.cx = Math.max(CATCHER_W / 2, Math.min(this.fw - CATCHER_W / 2, this.cx))
    const catcher: Rect = {
      x: field.x + this.cx - CATCHER_W / 2,
      y: field.y + field.h - CATCHER_H,
      w: CATCHER_W,
      h: CATCHER_H,
    }
    const hashPanel: Rect = {
      x: r.x + 10,
      y: r.y + r.h - BOTTOM_H + 6,
      w: Math.min(360, Math.floor(r.w * 0.46)),
      h: BOTTOM_H - 14,
    }
    const pauseBtn: Rect = { x: r.x + r.w - 164, y: hashPanel.y + 8, w: 156, h: 48 }
    this.geo = { field, pause: pauseBtn, hash: hashPanel }

    this.drawTop(ctx, r)
    this.drawField(ctx, field, catcher)
    this.drawBottom(ctx, r, hashPanel, pauseBtn, now)

    if (this.state === 'intro') this.drawIntro(ctx, r)
    if (this.state === 'paused') this.drawPaused(ctx, r, now)
    if (this.state === 'won') this.drawWon(ctx, r)
    if (this.state === 'failed') this.drawFail(ctx, r, now)
  }

  private drawTop(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, { x: r.x, y: r.y, w: r.w, h: TOP_H }, '#08140c')
    ctx.strokeStyle = 'rgba(126, 154, 132, 0.35)'
    ctx.beginPath()
    ctx.moveTo(r.x, r.y + TOP_H - 0.5)
    ctx.lineTo(r.x + r.w, r.y + TOP_H - 0.5)
    ctx.stroke()
    setFont(ctx, 10, true)
    ctx.fillStyle = '#9fd39f'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(`ПОТОК ${this.stream || '·················'}`, r.x + 10, r.y + TOP_H / 2)
    ctx.textAlign = 'right'
    ctx.fillStyle = this.green ? '#7fe08a' : '#c9ccc6'
    ctx.fillText(`ПЕРЕХВАЧЕНО: ${this.caught}`, r.x + r.w - 10, r.y + TOP_H / 2)
    ctx.textAlign = 'left'
  }

  private drawField(ctx: CanvasRenderingContext2D, field: Rect, catcher: Rect): void {
    fill(ctx, field, '#071009')
    // колонки ленты данных
    ctx.strokeStyle = 'rgba(126, 154, 132, 0.1)'
    ctx.beginPath()
    for (let x = field.x + 40; x < field.x + field.w; x += 40) {
      ctx.moveTo(x + 0.5, field.y)
      ctx.lineTo(x + 0.5, field.y + field.h)
    }
    ctx.stroke()
    // линия ловли
    ctx.strokeStyle = 'rgba(159, 211, 159, 0.35)'
    ctx.setLineDash([6, 6])
    ctx.beginPath()
    ctx.moveTo(field.x, field.y + field.h - 0.5)
    ctx.lineTo(field.x + field.w, field.y + field.h - 0.5)
    ctx.stroke()
    ctx.setLineDash([])
    // биты (не вылезают на строки состояния)
    ctx.save()
    ctx.beginPath()
    ctx.rect(field.x, field.y, field.w, field.h)
    ctx.clip()
    for (const b of this.bits) this.drawBit(ctx, field.x + b.x, field.y + b.y, b.bit)
    ctx.restore()
    // ловец
    const edge = this.green ? '#7fe08a' : '#4f8f57'
    ctx.strokeStyle = edge
    ctx.lineWidth = 2
    ctx.strokeRect(catcher.x + 1, catcher.y + 1, catcher.w - 2, catcher.h - 2)
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(159, 211, 159, 0.4)'
    ctx.strokeRect(catcher.x + 6.5, catcher.y + 6.5, catcher.w - 13, catcher.h - 13)
  }

  private drawBit(ctx: CanvasRenderingContext2D, x: number, y: number, bit: 0 | 1): void {
    const r: Rect = { x: x - BIT / 2, y: y - BIT / 2, w: BIT, h: BIT }
    fill(ctx, r, bit ? '#241c08' : '#0c1a10')
    ctx.strokeStyle = bit ? '#d8b25a' : '#4f8f57'
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
    setFont(ctx, 12, true)
    ctx.fillStyle = bit ? '#e8c46a' : '#9fd39f'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(bit), x, y + 1)
    ctx.textAlign = 'left'
  }

  private drawBottom(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    hp: Rect,
    pb: Rect,
    now: number,
  ): void {
    fill(ctx, { x: r.x, y: r.y + r.h - BOTTOM_H, w: r.w, h: BOTTOM_H }, '#08140c')
    ctx.strokeStyle = 'rgba(126, 154, 132, 0.35)'
    ctx.beginPath()
    ctx.moveTo(r.x, r.y + r.h - BOTTOM_H + 0.5)
    ctx.lineTo(r.x + r.w, r.y + r.h - BOTTOM_H + 0.5)
    ctx.stroke()

    // хэш-подпись: копится с битами, в окне подсвечивается зелёным,
    // при перелове — краснеет и рабочий стол уводит смотреть камеру
    const green = this.green
    const red = this.state === 'failed'
    if (red) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 120)
      ctx.shadowColor = '#e8523a'
      ctx.shadowBlur = 8 + pulse * 12
    } else if (green) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 140)
      ctx.shadowColor = '#7fe08a'
      ctx.shadowBlur = 6 + pulse * 10
    }
    fill(ctx, hp, red ? '#301010' : green ? '#123018' : '#0a1810')
    ctx.strokeStyle = red ? '#e8523a' : green ? '#7fe08a' : '#2c4a34'
    ctx.strokeRect(hp.x + 0.5, hp.y + 0.5, hp.w - 1, hp.h - 1)
    ctx.shadowBlur = 0
    text(ctx, 'ХЭШ-ПОДПИСЬ', hp.x + 8, hp.y + 10, { size: 8, bold: true, color: '#5f7f66' })
    ctx.font = `bold ${Math.round(15 * 1.12)}px Consolas, monospace`
    ctx.fillStyle = red ? '#e88a76' : green ? '#aef2b0' : '#7e9a84'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(this.hash, hp.x + hp.w / 2, hp.y + hp.h / 2 + 6)
    ctx.textAlign = 'left'
    const label = red
      ? 'ПОДПИСЬ ПОВРЕЖДЕНА'
      : this.state === 'paused'
        ? Math.floor(now / 300) % 2 === 0
          ? 'КЛИКНИ ПО ХЭШУ'
          : ''
        : green
          ? 'ПОДПИСЬ ВАЛИДНА'
          : 'ОЖИДАНИЕ ОКНА'
    if (label) {
      text(ctx, label, hp.x + hp.w - 8, hp.y + 10, {
        size: 8,
        bold: true,
        color: red ? '#e88a76' : green ? '#aef2b0' : '#5f7f66',
        align: 'right',
      })
    }

    // кнопка паузы: только мышь, поэтому в другом углу
    panel(ctx, pb, true, 1)
    if (green) {
      ctx.strokeStyle = '#7fe08a'
      ctx.strokeRect(pb.x + 1.5, pb.y + 1.5, pb.w - 3, pb.h - 3)
    }
    ctx.fillStyle = '#2a2a24'
    const bx = pb.x + 36
    const by = pb.y + pb.h / 2 - 6
    ctx.fillRect(bx, by, 4, 12)
    ctx.fillRect(bx + 8, by, 4, 12)
    text(ctx, 'ПАУЗА', pb.x + 94, pb.y + pb.h / 2, {
      size: 11,
      bold: true,
      color: '#16160f',
    })
  }

  private drawIntro(ctx: CanvasRenderingContext2D, r: Rect): void {
    ctx.fillStyle = 'rgba(4, 10, 6, 0.86)'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    const w = Math.min(420, r.w - 30)
    const h = 208
    const p: Rect = { x: r.x + (r.w - w) / 2, y: r.y + Math.max(10, (r.h - h) / 2 - 8), w, h }
    panel(ctx, p, true, 2)
    text(ctx, 'ПЕРЕХВАТ ПОТОКА', p.x + w / 2, p.y + 24, {
      size: 14,
      bold: true,
      color: '#16160f',
      align: 'center',
    })
    text(ctx, `цель скрыта: 15–23 бит · допустимо не больше +2`, p.x + w / 2, p.y + 44, {
      size: 10,
      color: '#5c5c54',
      align: 'center',
    })
    const lines = [
      'лови биты 0 и 1 квадратом — движение A/D',
      'хэш позеленеет, когда поймаешь нужное число',
      'успей нажать ПАУЗУ мышью и кликни по зелёному хэшу',
      'лишние три бита или пауза мимо — поток сбросится',
    ]
    let y = p.y + 68
    for (const line of lines) {
      text(ctx, line, p.x + w / 2, y, { size: 10, color: '#5c5c54', align: 'center' })
      y += 15
    }
    const btn: Rect = { x: p.x + w / 2 - 88, y: p.y + p.h - 30, w: 176, h: 22 }
    panel(ctx, btn, true, 1)
    text(ctx, 'ПРОБЕЛ — НАЧАТЬ', btn.x + btn.w / 2, btn.y + btn.h / 2, {
      size: 10,
      bold: true,
      align: 'center',
    })
    this.startBtn = btn
  }

  private drawPaused(ctx: CanvasRenderingContext2D, r: Rect, now: number): void {
    ctx.fillStyle = 'rgba(4, 10, 6, 0.5)'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    text(ctx, 'ПАУЗА', r.x + r.w / 2, r.y + r.h / 2 - 12, {
      size: 18,
      bold: true,
      color: '#aef2b0',
      align: 'center',
    })
    if (Math.floor(now / 300) % 2 === 0) {
      text(ctx, 'подпись заморожена — кликни по зелёному хэшу', r.x + r.w / 2, r.y + r.h / 2 + 12, {
        size: 11,
        color: '#c9ccc6',
        align: 'center',
      })
    }
  }

  private drawWon(ctx: CanvasRenderingContext2D, r: Rect): void {
    ctx.fillStyle = 'rgba(4, 10, 6, 0.85)'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    const w = Math.min(380, r.w - 30)
    const h = 170
    const p: Rect = { x: r.x + (r.w - w) / 2, y: r.y + Math.max(10, (r.h - h) / 2 - 8), w, h }
    panel(ctx, p, true, 2)
    text(ctx, 'ПОДПИСЬ ПРИНЯТА', p.x + w / 2, p.y + 24, {
      size: 14,
      bold: true,
      color: '#16160f',
      align: 'center',
    })
    text(ctx, 'код выхода из блока', p.x + w / 2, p.y + 44, {
      size: 10,
      color: '#5c5c54',
      align: 'center',
    })
    setFont(ctx, 26, true)
    ctx.fillStyle = '#16160f'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(this.password, p.x + w / 2, p.y + 74)
    ctx.textAlign = 'left'
    const lines = [
      'открой print.local, впиши код в строку',
      'и нажми «Печать» — бумажка выйдет',
      'из принтера на кухне.',
    ]
    let y = p.y + 100
    for (const line of lines) {
      text(ctx, line, p.x + w / 2, y, { size: 10, color: '#5c5c54', align: 'center' })
      y += 14
    }
  }

  private drawFail(ctx: CanvasRenderingContext2D, r: Rect, now: number): void {
    // глитч: рваные смещённые полосы кадра
    for (let i = 0; i < 8; i++) {
      const sy = r.y + Math.random() * r.h
      const sh = 4 + Math.random() * 22
      const dx = (Math.random() - 0.5) * 26
      ctx.drawImage(ctx.canvas, Math.round(dx), Math.round(sy), r.w, sh, r.x, Math.round(sy), r.w, sh)
    }
    ctx.fillStyle = 'rgba(60, 4, 2, 0.5)'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    // игра стоит: оператор извиняется перед тем, что сейчас увидит
    const w = Math.min(360, r.w - 30)
    const p: Rect = { x: r.x + (r.w - w) / 2, y: r.y + (r.h - 96) / 2, w, h: 96 }
    panel(ctx, p, true, 2)
    text(ctx, 'Мне очень жаль', p.x + w / 2, p.y + 34, {
      size: 17,
      bold: true,
      color: '#16160f',
      align: 'center',
    })
    if (Math.floor(now / 400) % 2 === 0) {
      text(ctx, 'подпись повреждена · она уже не одна', p.x + w / 2, p.y + 62, {
        size: 10,
        color: '#6a5a4a',
        align: 'center',
      })
    }
  }
}

/**
 * «print.local» — служебная печать: единственное, что умеет этот узел, —
 * принять пароль в строку и отправить бумажку на принтер кухни. Пароль он
 * не проверяет: проверяет дверь.
 */
export class PrintSite {
  /** Нажата «Печать»: код уходит на принтер в кухне (любой, хоть неверный). */
  onPrint?: (code: string) => void

  private sound: Sound
  private input = ''
  private focus = false
  private printed = false
  private inputRect: Rect | null = null
  private printBtn: Rect | null = null

  constructor(sound: Sound) {
    this.sound = sound
    ;(window as unknown as { __printsite?: PrintSite }).__printsite = this
    window.addEventListener('blur', () => {
      this.focus = false
    })
  }

  debugState(): object {
    return { input: this.input, printed: this.printed }
  }

  /** Строка и кнопка — для кликов из tools/. */
  debugForm(): { input: { x: number; y: number }; print: { x: number; y: number } } | null {
    if (!this.inputRect || !this.printBtn) return null
    return {
      input: {
        x: this.inputRect.x + this.inputRect.w / 2,
        y: this.inputRect.y + this.inputRect.h / 2,
      },
      print: {
        x: this.printBtn.x + this.printBtn.w / 2,
        y: this.printBtn.y + this.printBtn.h / 2,
      },
    }
  }

  tick(): boolean {
    return false
  }

  key(e: KeyboardEvent): boolean {
    if (!this.focus) return false
    if (e.key === 'Escape') {
      this.focus = false
      return true
    }
    if (e.key === 'Backspace') {
      this.input = this.input.slice(0, -1)
      return true
    }
    if (/^[0-9]$/.test(e.key) && this.input.length < 6) {
      this.input += e.key
      this.sound.step()
      return true
    }
    return false
  }

  click(x: number, y: number): boolean {
    if (this.inputRect && inside(this.inputRect, x, y)) {
      this.focus = true
      this.sound.click()
      return true
    }
    if (this.printBtn && inside(this.printBtn, x, y) && this.input.length > 0) {
      this.printed = true
      this.sound.busy()
      this.onPrint?.(this.input)
      // поле чистится: печатать можно сколько угодно раз, каждый лист — свой код
      this.input = ''
      return true
    }
    this.focus = false
    return false
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, '#08110c')
    const w = Math.min(430, r.w - 30)
    const h = 250
    const p: Rect = { x: r.x + (r.w - w) / 2, y: r.y + Math.max(14, (r.h - h) / 2 - 10), w, h }
    panel(ctx, p, true, 2)

    text(ctx, 'СЛУЖЕБНАЯ ПЕЧАТЬ', p.x + w / 2, p.y + 24, {
      size: 14,
      bold: true,
      color: '#16160f',
      align: 'center',
    })
    text(ctx, 'узел print.local · кухня блока C', p.x + w / 2, p.y + 44, {
      size: 10,
      color: '#5c5c54',
      align: 'center',
    })
    const lines = [
      'Это поле для ввода пароля выхода.',
      'Впишите код — принтер на кухне выведет бумажку,',
      'и девушка отнесёт её к двери.',
    ]
    let y = p.y + 70
    for (const line of lines) {
      text(ctx, line, p.x + w / 2, y, { size: 11, color: '#23231c', align: 'center' })
      y += 16
    }

    const field: Rect = { x: p.x + w / 2 - 90, y: y + 6, w: 180, h: 28 }
    fill(ctx, field, '#ffffff')
    ctx.strokeStyle = this.focus ? '#2c4f86' : '#4a4a44'
    ctx.strokeRect(field.x + 0.5, field.y + 0.5, field.w - 1, field.h - 1)
    setFont(ctx, 13, true)
    ctx.fillStyle = '#23231c'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(this.input || '· · · ·', field.x + field.w / 2, field.y + field.h / 2)
    if (this.focus && Math.floor(performance.now() / 500) % 2 === 0) {
      ctx.fillStyle = '#111111'
      ctx.fillRect(
        field.x + field.w / 2 + (this.input ? 14 : -16),
        field.y + 5,
        1,
        field.h - 10,
      )
    }
    ctx.textAlign = 'left'
    this.inputRect = field

    const btn: Rect = { x: p.x + w / 2 - 70, y: field.y + field.h + 12, w: 140, h: 26 }
    panel(ctx, btn, this.input.length > 0, 1)
    text(ctx, 'ПЕЧАТЬ', btn.x + btn.w / 2, btn.y + btn.h / 2, {
      size: 11,
      bold: true,
      color: this.input.length > 0 ? '#16160f' : '#8e8e86',
      align: 'center',
    })
    this.printBtn = btn

    text(
      ctx,
      this.printed ? 'отправлено на печать · следите за кухней' : 'печать доступна только с этого узла',
      p.x + w / 2,
      p.y + p.h - 12,
      { size: 10, color: this.printed ? '#2f6b2f' : '#5c5c54', align: 'center' },
    )
  }
}
