/**
 * «pairs.local» — головоломка-пары на память, второй домен в браузере.
 *
 * Два этапа: сетка 9×9 с восемью парами, затем 12×12 с двенадцатью. Карты
 * открываются на несколько секунд — запомни, где что лежит, потом перевери
 * всё по памяти. На каждый этап даётся 8 попыток; промах = открытая
 * несовпавшая пара. Попытки кончились — связь обрывается: в кухне в этот
 * момент начинается худшее (сцену провала двигает рабочий стол).
 *
 * После обоих этапов сайт показывает пароль выхода: его вписывают в строку
 * и отправляют на печать — бумажку вынесет принтер на кухне. Сайт пароль не
 * проверяет: проверяет дверь. Неверный пароль печатается так же честно.
 *
 * Игра не знает ни про браузер, ни про кухню: наружу только onFail/onPrint.
 */
import { fill, inside, panel, setFont, text } from '../draw'
import type { Rect } from '../draw'
import { drawIcon } from '../icons'
import type { Sound } from '../../audio'

type Stage = { cols: number; rows: number; pairs: number; showMs: number }

const STAGES: Stage[] = [
  { cols: 9, rows: 9, pairs: 8, showMs: 6000 },
  { cols: 12, rows: 12, pairs: 12, showMs: 8000 },
]
const ATTEMPTS = 8 // на каждый этап
const MISS_MS = 700 // сколько висит несовпавшая пара
const DONE_MS = 1400

/** Лица карт: процедурные значки игры. На этап берётся случайная выборка. */
const KINDS = [
  'virus',
  'knife',
  'meat',
  'lamp',
  'key',
  'camera',
  'map',
  'folder',
  'computer',
  'trash',
  'mail',
  'browser',
] as const

type Card = { kind: string; state: 'hidden' | 'open' | 'matched'; pos: number }
type State = 'intro' | 'memorize' | 'play' | 'stageDone' | 'won' | 'failed'

export class PairsGame {
  /** Попытки кончились: рабочий стол запускает сцену провала. */
  onFail?: () => void
  /** Нажата «Печать»: код уходит на принтер в кухне (любой, хоть неверный). */
  onPrint?: (code: string) => void

  private sound: Sound
  private stage = 0 // индекс в STAGES
  private state: State = 'intro'
  private cards: Card[] = []
  private kinds: string[] = []
  private attempts = ATTEMPTS
  private openIdx: number[] = []
  private missAt = 0
  private missPair: number[] = []
  private phaseAt = 0
  private password = ''
  private printed = false
  private failSent = false
  private inputFocus = false
  private input = ''
  private startBtn: Rect | null = null
  private inputRect: Rect | null = null
  private printBtn: Rect | null = null
  /** Геометрия последнего кадра — для кликов и отладки. */
  private geo: { ox: number; oy: number; cell: number } = { ox: 0, oy: 0, cell: 24 }

  constructor(sound: Sound) {
    this.sound = sound
    this.buildStage(0)
    ;(window as unknown as { __pairs?: PairsGame }).__pairs = this
    window.addEventListener('blur', () => {
      this.inputFocus = false
    })
  }

  // ── отладка для tools/ ───────────────────────────────────────────

  debugState(): object {
    return {
      state: this.state,
      stage: this.stage + 1,
      attempts: this.attempts,
      matched: this.cards.filter((c) => c.state === 'matched').length / 2,
      pairs: this.cards.length / 2,
      password: this.password || null,
      printed: this.printed,
      input: this.input,
    }
  }

  /** Пропустить показ: сразу фаза поиска. */
  debugSkipMemorize(): void {
    if (this.state === 'memorize') {
      this.state = 'play'
      this.phaseAt = performance.now()
    }
  }

  /** Мгновенно собрать все пары текущего этапа (инструменты проверки). */
  debugSolveStage(): void {
    if (this.state !== 'play') return
    for (const c of this.cards) c.state = 'matched'
    this.finishStage()
  }

  debugPrint(code: string): void {
    this.onPrint?.(code)
  }

  /** Карты с пиксельными центрами — инструменты проверки кликают по ним. */
  debugCards(): Array<{ kind: string; state: string; x: number; y: number }> {
    const { ox, oy, cell } = this.geo
    const cols = this.cfg.cols
    return this.cards.map((c) => ({
      kind: c.kind,
      state: c.state,
      x: ox + (c.pos % cols) * cell + cell / 2,
      y: oy + Math.floor(c.pos / cols) * cell + cell / 2,
    }))
  }

  /** Строка ввода и кнопка «Печать» на экране пароля — для кликов из tools/. */
  debugForm(): { input: { x: number; y: number }; print: { x: number; y: number } } | null {
    if (!this.inputRect || !this.printBtn) return null
    return {
      input: { x: this.inputRect.x + this.inputRect.w / 2, y: this.inputRect.y + this.inputRect.h / 2 },
      print: { x: this.printBtn.x + this.printBtn.w / 2, y: this.printBtn.y + this.printBtn.h / 2 },
    }
  }

  /** Рабочий стол перезапустил смену — сайт встаёт на начало. */
  reset(): void {
    this.stage = 0
    this.password = ''
    this.printed = false
    this.failSent = false
    this.input = ''
    this.inputFocus = false
    this.buildStage(0)
  }

  // ── сборка этапа ─────────────────────────────────────────────────

  private buildStage(index: number): void {
    const s = STAGES[index]
    this.stage = index
    this.attempts = ATTEMPTS
    this.openIdx = []
    this.missPair = []
    this.state = 'intro'
    this.phaseAt = 0

    // набор лиц: на этап 1 — 8 случайных из 12, на этап 2 — все
    const pool = [...KINDS]
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    this.kinds = pool.slice(0, s.pairs)

    const spots: number[] = []
    for (let i = 0; i < s.cols * s.rows; i++) spots.push(i)
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[spots[i], spots[j]] = [spots[j], spots[i]]
    }
    const faces = [...this.kinds, ...this.kinds]
    for (let i = faces.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[faces[i], faces[j]] = [faces[j], faces[i]]
    }
    this.cards = faces.map((kind, i) => ({ kind, state: 'hidden', pos: spots[i] }))
  }

  private get cfg(): Stage {
    return STAGES[this.stage]
  }

  // ── жизненный цикл ───────────────────────────────────────────────

  tick(): boolean {
    const now = performance.now()

    if (this.state === 'memorize' && now - this.phaseAt >= this.cfg.showMs) {
      this.state = 'play'
      this.phaseAt = now
      return true
    }
    // несовпавшая пара закрывается сама
    if (this.missPair.length > 0 && now - this.missAt >= MISS_MS) {
      for (const i of this.missPair) {
        const c = this.cards[i]
        if (c && c.state === 'open') c.state = 'hidden'
      }
      this.missPair = []
      this.openIdx = []
      return true
    }
    if (this.state === 'stageDone' && now - this.phaseAt >= DONE_MS) {
      if (this.stage + 1 < STAGES.length) {
        this.buildStage(this.stage + 1)
      } else {
        this.state = 'won'
        if (!this.password) {
          this.password = String(1000 + Math.floor(Math.random() * 9000))
        }
        this.printed = false
        this.sound.message()
      }
      return true
    }
    return false
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'Space' && !e.repeat) {
      if (this.state === 'intro') {
        this.state = 'memorize'
        this.phaseAt = performance.now()
        this.sound.click()
        return true
      }
      return false
    }
    if (this.state === 'won' && this.inputFocus) {
      if (e.key === 'Escape') {
        this.inputFocus = false
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
    }
    return false
  }

  click(x: number, y: number): boolean {
    const now = performance.now()
    if (this.state === 'intro' && this.startBtn && inside(this.startBtn, x, y)) {
      this.state = 'memorize'
      this.phaseAt = now
      this.sound.click()
      return true
    }
    if (this.state === 'won') {
      if (this.inputRect && inside(this.inputRect, x, y)) {
        this.inputFocus = true
        this.sound.click()
        return true
      }
      if (this.printBtn && inside(this.printBtn, x, y) && this.input.length > 0) {
        this.printed = true
        this.sound.busy()
        this.onPrint?.(this.input)
        return true
      }
      if (this.inputFocus && this.inputRect && !inside(this.inputRect, x, y)) {
        this.inputFocus = false
      }
      return false
    }
    if (this.state !== 'play') return false
    if (this.missPair.length > 0) return false // ждём, пока пара закроется

    const { ox, oy, cell } = this.geo
    const col = Math.floor((x - ox) / cell)
    const row = Math.floor((y - oy) / cell)
    if (col < 0 || row < 0 || col >= this.cfg.cols || row >= this.cfg.rows) return false
    const pos = row * this.cfg.cols + col
    const idx = this.cards.findIndex((c) => c.pos === pos)
    if (idx < 0) return false // пустая ячейка
    const card = this.cards[idx]
    if (card.state !== 'hidden') return false

    card.state = 'open'
    this.openIdx.push(idx)
    this.sound.cardFlip()

    if (this.openIdx.length === 2) {
      const [a, b] = this.openIdx
      if (this.cards[a].kind === this.cards[b].kind) {
        this.cards[a].state = 'matched'
        this.cards[b].state = 'matched'
        this.openIdx = []
        this.sound.cardMatch()
        if (this.cards.every((c) => c.state === 'matched')) this.finishStage()
      } else {
        this.attempts--
        this.missAt = now
        this.missPair = [a, b]
        this.sound.cardMiss()
        if (this.attempts <= 0) {
          // пара ещё закроется по таймеру, но провал фиксируем сразу
          this.fail()
        }
      }
      return true
    }
    return true
  }

  private finishStage(): void {
    this.state = 'stageDone'
    this.phaseAt = performance.now()
    this.sound.stageClear()
  }

  private fail(): void {
    this.state = 'failed'
    this.sound.pairsFail()
    if (!this.failSent) {
      this.failSent = true
      this.onFail?.()
    }
  }

  // ── отрисовка ────────────────────────────────────────────────────

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, '#050d08')
    const now = performance.now()

    const hud = 26
    const pad = 12
    const gridArea: Rect = { x: r.x + pad, y: r.y + hud + 6, w: r.w - pad * 2, h: r.h - hud * 2 - 16 }
    const { cols, rows } = this.cfg
    const cell = Math.max(8, Math.floor(Math.min(gridArea.w / cols, gridArea.h / rows)) - 2)
    const ox = gridArea.x + (gridArea.w - cell * cols) / 2
    const oy = gridArea.y + (gridArea.h - cell * rows) / 2
    this.geo = { ox, oy, cell }

    this.drawHud(ctx, r, hud, now)
    if (this.state === 'won') {
      this.drawPassword(ctx, r, now)
      return
    }

    // слоты сетки
    const slot = Math.max(2, Math.floor(cell / 10))
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = ox + col * cell
        const y = oy + row * cell
        fill(ctx, { x: x + slot, y: y + slot, w: cell - slot * 2, h: cell - slot * 2 }, '#0a1810')
      }
    }
    // карты
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i]
      const col = card.pos % cols
      const row = Math.floor(card.pos / cols)
      this.drawCard(ctx, card, ox + col * cell, oy + row * cell, cell, now, i)
    }

    // фаза показа: полоса обратного отсчёта под сеткой
    if (this.state === 'memorize') {
      const p = Math.min(1, (now - this.phaseAt) / this.cfg.showMs)
      const bar: Rect = { x: r.x + r.w / 2 - 130, y: r.y + r.h - 14, w: 260, h: 5 }
      fill(ctx, bar, 'rgba(120, 160, 130, 0.25)')
      fill(ctx, { ...bar, w: Math.round(bar.w * (1 - p)) }, 'rgba(216, 178, 90, 0.9)')
      text(ctx, 'ЗАПОМНИВАЙ', r.x + r.w / 2, r.y + r.h - 24, {
        size: 10,
        bold: true,
        color: '#d8b25a',
        align: 'center',
      })
    }

    if (this.state === 'intro') this.drawIntro(ctx, r)
    if (this.state === 'stageDone') {
      text(ctx, 'ЭТАП ПРОЙДЕН', r.x + r.w / 2, r.y + r.h / 2 - 8, {
        size: 18,
        bold: true,
        color: '#9fd39f',
        align: 'center',
      })
    }
    if (this.state === 'failed') this.drawFail(ctx, r, now)
  }

  private drawCard(
    ctx: CanvasRenderingContext2D,
    card: Card,
    x: number,
    y: number,
    cell: number,
    now: number,
    idx: number,
  ): void {
    const inset = Math.max(2, Math.floor(cell / 10))
    const r: Rect = { x: x + inset, y: y + inset, w: cell - inset * 2, h: cell - inset * 2 }
    // в фазе показа карты лежат лицом вверх, хотя формально ещё «закрыты»
    const faceUp = card.state !== 'hidden' || this.state === 'memorize'
    if (!faceUp) {
      // рубашка: светлая фаска Win2000 с тыквенным водяным знаком
      panel(ctx, r, true, 1)
      if (cell >= 18) {
        ctx.globalAlpha = 0.16
        drawIcon(ctx, 'virus', r.x + r.w / 2, r.y + r.h / 2, (cell - inset * 2) / 44)
        ctx.globalAlpha = 1
      }
      return
    }
    const missed = this.missPair.includes(idx) && now - this.missAt < MISS_MS
    fill(ctx, r, '#101f16')
    ctx.strokeStyle = missed ? '#d4402e' : card.state === 'matched' ? '#2c7a2c' : '#4f8f57'
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
    drawIcon(ctx, card.kind, r.x + r.w / 2, r.y + r.h / 2, (cell - inset * 2) / 38)
  }

  private drawHud(ctx: CanvasRenderingContext2D, r: Rect, hud: number, now: number): void {
    fill(ctx, { x: r.x, y: r.y, w: r.w, h: hud }, '#08140c')
    ctx.strokeStyle = 'rgba(126, 154, 132, 0.35)'
    ctx.beginPath()
    ctx.moveTo(r.x, r.y + hud - 0.5)
    ctx.lineTo(r.x + r.w, r.y + hud - 0.5)
    ctx.stroke()
    const s = this.cfg
    const found = this.cards.filter((c) => c.state === 'matched').length / 2
    setFont(ctx, 10, true)
    ctx.fillStyle = '#9fd39f'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(`ЭТАП ${this.stage + 1}/2 · СЕТКА ${s.cols}×${s.rows}`, r.x + 10, r.y + hud / 2)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#c9ccc6'
    ctx.fillText(`ПАРЫ: ${found}/${this.cards.length / 2}`, r.x + r.w / 2, r.y + hud / 2)
    const low = this.attempts <= 2 && this.state !== 'intro'
    const blink = low && Math.floor(now / 300) % 2 === 0
    ctx.fillStyle = blink ? '#d4402e' : low ? '#d47a5a' : '#c9ccc6'
    ctx.textAlign = 'right'
    ctx.fillText(`ПОПЫТКИ: ${Math.max(0, this.attempts)}`, r.x + r.w - 10, r.y + hud / 2)
    ctx.textAlign = 'left'
  }

  private drawIntro(ctx: CanvasRenderingContext2D, r: Rect): void {
    ctx.fillStyle = 'rgba(4, 10, 6, 0.85)'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    const w = Math.min(400, r.w - 30)
    const h = 172
    const p: Rect = { x: r.x + (r.w - w) / 2, y: r.y + Math.max(10, (r.h - h) / 2 - 8), w, h }
    panel(ctx, p, true, 2)
    text(ctx, `ЭТАП ${this.stage + 1} ИЗ 2`, p.x + w / 2, p.y + 22, {
      size: 14,
      bold: true,
      color: '#16160f',
      align: 'center',
    })
    text(
      ctx,
      `сетка ${this.cfg.cols}×${this.cfg.rows} · пар: ${this.cfg.pairs} · попыток: ${ATTEMPTS}`,
      p.x + w / 2,
      p.y + 44,
      { size: 11, color: '#16160f', align: 'center' },
    )
    const lines = [
      'карты откроются на несколько секунд —',
      'запомни, где какая, потом найди все пары.',
      'промах сжигает попытку. попыток нет —',
      'связь обрывается, и на кухне кто-то просыпается.',
    ]
    let y = p.y + 66
    for (const line of lines) {
      text(ctx, line, p.x + w / 2, y, { size: 10, color: '#5c5c54', align: 'center' })
      y += 14
    }
    const btn: Rect = { x: p.x + w / 2 - 88, y: p.y + p.h - 32, w: 176, h: 22 }
    panel(ctx, btn, true, 1)
    text(ctx, 'ПРОБЕЛ — ОТКРЫТЬ КАРТЫ', btn.x + btn.w / 2, btn.y + btn.h / 2, {
      size: 10,
      bold: true,
      align: 'center',
    })
    this.startBtn = btn
  }

  private drawFail(ctx: CanvasRenderingContext2D, r: Rect, now: number): void {
    // глитч: рваные смещённые полосы кадра
    for (let i = 0; i < 8; i++) {
      const sy = r.y + Math.random() * r.h
      const sh = 4 + Math.random() * 22
      const dx = (Math.random() - 0.5) * 26
      ctx.drawImage(ctx.canvas, Math.round(dx), Math.round(sy), r.w, sh, r.x, Math.round(sy), r.w, sh)
    }
    ctx.fillStyle = 'rgba(60, 4, 2, 0.45)'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    text(ctx, 'СВЯЗЬ ПРЕРВАНА', r.x + r.w / 2, r.y + r.h / 2 - 16, {
      size: 20,
      bold: true,
      color: '#e8523a',
      align: 'center',
    })
    if (Math.floor(now / 400) % 2 === 0) {
      text(ctx, 'попытки исчерпаны · на кухне стало тихо', r.x + r.w / 2, r.y + r.h / 2 + 10, {
        size: 11,
        color: '#c9a08a',
        align: 'center',
      })
    }
  }

  private drawPassword(ctx: CanvasRenderingContext2D, r: Rect, now: number): void {
    const w = Math.min(430, r.w - 30)
    const h = 236
    const p: Rect = { x: r.x + (r.w - w) / 2, y: r.y + Math.max(10, (r.h - h) / 2 - 8), w, h }
    panel(ctx, p, true, 2)
    text(ctx, 'ДОСТУП ПОЛУЧЕН', p.x + w / 2, p.y + 22, {
      size: 14,
      bold: true,
      color: '#16160f',
      align: 'center',
    })
    text(ctx, 'пароль выхода из блока', p.x + w / 2, p.y + 42, {
      size: 10,
      color: '#5c5c54',
      align: 'center',
    })

    // пароль крупно
    setFont(ctx, 26, true)
    ctx.fillStyle = '#16160f'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(this.password, p.x + w / 2, p.y + 74)
    ctx.textAlign = 'left'

    const lines = [
      'впишите пароль в строку и нажмите «Печать» —',
      'бумажку вынесет принтер на кухне.',
      'ошибётесь — она дойдёт до двери и дверь откажет.',
    ]
    let y = p.y + 98
    for (const line of lines) {
      text(ctx, line, p.x + w / 2, y, { size: 10, color: '#5c5c54', align: 'center' })
      y += 14
    }

    // строка ввода
    const field: Rect = { x: p.x + w / 2 - 90, y: y + 4, w: 180, h: 26 }
    fill(ctx, field, '#ffffff')
    ctx.strokeStyle = this.inputFocus ? '#2c4f86' : '#4a4a44'
    ctx.strokeRect(field.x + 0.5, field.y + 0.5, field.w - 1, field.h - 1)
    setFont(ctx, 13, true)
    ctx.fillStyle = '#23231c'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const shown = this.input || '· · · ·'
    ctx.fillText(shown, field.x + field.w / 2, field.y + field.h / 2)
    if (this.inputFocus && Math.floor(now / 500) % 2 === 0) {
      ctx.fillStyle = '#111111'
      ctx.fillRect(field.x + field.w / 2 + (this.input ? 14 : -16), field.y + 5, 1, field.h - 10)
    }
    ctx.textAlign = 'left'
    this.inputRect = field

    // кнопка печати
    const btn: Rect = { x: p.x + w / 2 - 70, y: field.y + field.h + 10, w: 140, h: 26 }
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
      this.printed ? 'отправлено на печать · следите за кухней' : '',
      p.x + w / 2,
      p.y + p.h - 12,
      { size: 10, color: '#2f6b2f', align: 'center' },
    )
  }
}
