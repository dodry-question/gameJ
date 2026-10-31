/**
 * power.local — «релейный щит 3B»: возврат питания линиям камер блока C.
 *
 * Два этапа, всё мышью. «ФАЗА»: на осциллографе совместить свою синусоиду
 * с опорной тремя ползунками (частота, фаза, амплитуда) и удержать
 * совпадение — опорная фаза медленно дрейфует, надо догонять. «ЛИНИЯ»:
 * включить рубильники в порядке из паспорта щита; ошибка — КЗ, все
 * рубильники откатываются. Компонент ничего не знает о камерах и карте:
 * наружу только onWin.
 */
import { fill, panel, setFont } from '../draw'
import type { Rect } from '../draw'
import type { Sound } from '../../audio'

type Stage = 'phase' | 'line' | 'won'

const GREEN = '#9fd39f'
const DIM = '#5f6f62'
const AMBER = '#d8b25a'
const BG = '#050d08'

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

/** Порядок рубильников из паспорта и их раскладка на панели (перемешана). */
const ORDER = ['СЕТЬ', 'ЩИТ', 'ЛИНИЯ', 'ШИНА'] as const
const LAYOUT = ['ЛИНИЯ', 'ШИНА', 'СЕТЬ', 'ЩИТ'] as const

type Slider = { label: string; v: number; r: Rect | null }

export class PowerGame {
  /** Щит дал питание: рабочий стол оживляет узел 01 и ретранслятор кухни. */
  onWin?: () => void

  private stage: Stage = 'phase'
  private sound: Sound
  /** Ползунки: частота, фаза, амплитуда (0…1). */
  private sliders: Slider[] = [
    { label: 'ЧАСТОТА', v: 0.22, r: null },
    { label: 'ФАЗА', v: 0.62, r: null },
    { label: 'АМПЛИТУДА', v: 0.35, r: null },
  ]
  private dragIdx = -1
  /** Удержанное совпадение, 0…1 — за него отвечает выдержка 1.6 с. */
  private sync = 0
  private matched = false
  /** Рубильники: сколько из порядка включено, позиции рычагов. */
  private done = 0
  private levers = LAYOUT.map(() => 0)
  private accidents = 0
  private sparkUntil = 0
  /** Ректы для кликов — собираются при отрисовке. */
  private leverHits: Array<{ r: Rect; label: string }> = []
  private t = 0

  constructor(sound: Sound) {
    this.sound = sound
    ;(window as unknown as { __power?: PowerGame }).__power = this
  }

  /** Состояние щита — для инструментов проверки. */
  debugState(): object {
    return {
      stage: this.stage,
      sync: +this.sync.toFixed(2),
      err: this.stage === 'phase' ? +this.err().toFixed(2) : null,
      done: this.done,
      accidents: this.accidents,
    }
  }

  /** Центры ручек ползунков и подписи рубильников — инструменты проверки. */
  debugTargets(): { sliders: Array<{ x: number; y: number }>; levers: string[] } | null {
    if (!this.sliders[0].r) return null
    return {
      sliders: this.sliders.map((s) => ({
        x: (s.r as Rect).x + 7 + ((s.r as Rect).w - 14) * s.v,
        y: (s.r as Rect).y + (s.r as Rect).h / 2,
      })),
      levers: this.leverHits.map((l) => l.label),
    }
  }

  /** Прямо задать ползунок (инструменты проверки). */
  debugSlider(i: number, v: number): void {
    this.sliders[i].v = clamp(v, 0, 1)
  }

  /** Клик по рубильнику с подписью (инструменты проверки). */
  debugLever(label: string): void {
    this.flip(label)
  }

  /** Текущая опорная фаза — инструменты подгоняют ползунок под неё. */
  debugRefPhase(): number {
    return this.refPhase(this.t)
  }

  /** Паспортные параметры опоры: точка, к которой гонится синусоида. */
  private get refF(): number {
    return 1.55
  }
  private get refA(): number {
    return 0.62
  }
  /** Опорная фаза медленно гуляет: её догоняют ползунком. */
  private refPhase(t: number): number {
    return t * 0.13 + Math.sin(t * 0.021) * 1.15 + Math.sin(t * 0.047) * 0.4
  }

  tick(): boolean {
    this.t += 0.016
    if (this.stage !== 'phase') return this.sparkUntil > performance.now()
    // нормированная ошибка по трём параметрам: <1 — совпадение
    const now = this.err() < 1
    if (now) this.sync = Math.min(1, this.sync + 0.016 / 1.6)
    else this.sync = Math.max(0, this.sync - 0.016 / 0.6)
    if (now !== this.matched) {
      this.matched = now
      this.sound.click()
    }
    if (this.sync >= 1) {
      this.stage = 'line'
      this.sound.relay()
      return true
    }
    return true
  }

  /** Текущая нормированная ошибка — для подсветки и выдержки. */
  private err(): number {
    const f = 0.4 + this.sliders[0].v * 2.4
    const ph = this.sliders[1].v * Math.PI * 2
    const a = 0.15 + this.sliders[2].v * 0.85
    const r0 = this.refPhase(this.t)
    const dPh = Math.abs((((ph - r0) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI)
    return Math.max(
      Math.abs(f - this.refF) / 0.16,
      dPh / 0.3,
      Math.abs(a - this.refA) / 0.1,
    )
  }

  /** Клик: ползунки и рубильники. true — событие съедено. */
  click(x: number, y: number): boolean {
    if (this.stage === 'won') return true
    for (const s of this.sliders) {
      if (s.r && x >= s.r.x - 14 && x <= s.r.x + s.r.w + 14 && y >= s.r.y - 6 && y <= s.r.y + s.r.h + 6) {
        this.dragIdx = this.sliders.indexOf(s)
        this.applySlider(x)
        return true
      }
    }
    if (this.stage !== 'line') return true
    for (const lv of this.leverHits) {
      if (x >= lv.r.x && y >= lv.r.y && x < lv.r.x + lv.r.w && y < lv.r.y + lv.r.h) {
        this.flip(lv.label)
        return true
      }
    }
    return true
  }

  drag(x: number, _y: number): void {
    if (this.dragIdx >= 0) this.applySlider(x)
  }

  release(): void {
    this.dragIdx = -1
  }

  private applySlider(x: number): void {
    const s = this.sliders[this.dragIdx]
    if (!s?.r) return
    s.v = clamp((x - s.r.x - 7) / (s.r.w - 14), 0, 1)
  }

  private flip(label: string): void {
    if (this.stage !== 'line') return
    const want = ORDER[this.done]
    if (label === want) {
      this.levers[LAYOUT.indexOf(label as (typeof LAYOUT)[number])] = 1
      this.done++
      this.sound.relay()
      if (this.done >= ORDER.length) {
        this.stage = 'won'
        this.sound.open()
        this.onWin?.()
      }
    } else {
      // короткое замыкание: всё откатывается, счёт аварий растёт
      this.done = 0
      this.levers = this.levers.map(() => 0)
      this.accidents++
      this.sparkUntil = performance.now() + 700
      this.sound.error()
    }
  }

  draw(ctx: CanvasRenderingContext2D, p: Rect): void {
    fill(ctx, p, BG)
    this.leverHits = []
    if (this.stage === 'phase') this.drawPhase(ctx, p)
    else this.drawLine(ctx, p)
    // вспышка КЗ поверх всего
    if (performance.now() < this.sparkUntil && this.stage === 'line') {
      ctx.fillStyle = `rgba(220, 80, 50, ${0.28 * ((this.sparkUntil - performance.now()) / 700)})`
      ctx.fillRect(p.x, p.y, p.w, p.h)
    }
  }

  // ── этап «ФАЗА»: осциллограф и ползунки ──────────────────────────

  private drawPhase(ctx: CanvasRenderingContext2D, p: Rect): void {
    const pad = 16
    // паспорт щита справа
    const doc: Rect = { x: p.x + p.w - 232, y: p.y + pad + 34, w: 216, h: 148 }
    panel(ctx, doc, true, 1)
    fill(ctx, { x: doc.x + 3, y: doc.y + 3, w: doc.w - 6, h: doc.h - 6 }, '#0a160d')
    setFont(ctx, 10, true)
    ctx.fillStyle = AMBER
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('ПАСПОРТ ЩИТА 3B', doc.x + 12, doc.y + 20)
    setFont(ctx, 9)
    ctx.fillStyle = DIM
    const lines = [
      'совмести сигнал с опорным',
      'ползунками: частота, фаза,',
      'амплитуда',
      '',
      'опорная фаза дрейфует —',
      'удержи совпадение 1.6 с',
    ]
    let ly = doc.y + 38
    for (const l of lines) {
      ctx.fillText(l, doc.x + 12, ly)
      ly += 14
    }

    // статус совпадения
    setFont(ctx, 10, true)
    ctx.fillStyle = this.matched ? GREEN : AMBER
    ctx.fillText(
      this.matched ? 'СИНХРОНИЗАЦИЯ УДЕРЖИВАЕТСЯ' : 'СИНХРОНИЗАЦИЯ: ПОДГОНЯЙ ПОЛЗУНКИ',
      p.x + pad,
      p.y + pad + 12,
    )

    // осциллограф: компактно, чтобы ползунки влезли в окно браузера
    const scope: Rect = {
      x: p.x + pad,
      y: p.y + pad + 22,
      w: p.w - 232 - pad * 2 - 16,
      h: 156,
    }
    fill(ctx, scope, '#071009')
    ctx.strokeStyle = 'rgba(110, 160, 120, 0.25)'
    for (let i = 1; i < 10; i++) {
      const gx = scope.x + (scope.w * i) / 10
      ctx.beginPath()
      ctx.moveTo(gx, scope.y)
      ctx.lineTo(gx, scope.y + scope.h)
      ctx.stroke()
    }
    for (let i = 1; i < 6; i++) {
      const gy = scope.y + (scope.h * i) / 6
      ctx.beginPath()
      ctx.moveTo(scope.x, gy)
      ctx.lineTo(scope.x + scope.w, gy)
      ctx.stroke()
    }
    // рамка
    ctx.strokeStyle = '#24402a'
    ctx.strokeRect(scope.x + 0.5, scope.y + 0.5, scope.w - 1, scope.h - 1)

    // опорная (янтарная, тусклая) и своя (зелёная) синусоиды
    const r0 = this.refPhase(this.t)
    const wave = (
      f: number,
      ph: number,
      a: number,
      color: string,
      width: number,
    ): void => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      for (let i = 0; i <= 120; i++) {
        const u = i / 120
        const yy =
          scope.y + scope.h / 2 - Math.sin(u * Math.PI * 2 * f + ph) * a * (scope.h / 2 - 8)
        const xx = scope.x + u * scope.w
        if (i === 0) ctx.moveTo(xx, yy)
        else ctx.lineTo(xx, yy)
      }
      ctx.stroke()
      ctx.lineWidth = 1
    }
    wave(this.refF, r0, this.refA, 'rgba(216, 178, 90, 0.55)', 1.5)
    const e = this.err()
    const near = e < 1.6
    wave(
      0.4 + this.sliders[0].v * 2.4,
      this.sliders[1].v * Math.PI * 2,
      0.15 + this.sliders[2].v * 0.85,
      this.matched ? '#b8f0b8' : near ? GREEN : '#5f8f66',
      this.matched ? 2 : 1.5,
    )

    // полоса выдержки
    const barW = scope.w
    const bar: Rect = { x: scope.x, y: scope.y + scope.h + 10, w: barW, h: 9 }
    panel(ctx, bar, false, 1)
    fill(ctx, { x: bar.x + 2, y: bar.y + 2, w: bar.w - 4, h: bar.h - 4 }, '#10201a')
    fill(
      ctx,
      { x: bar.x + 2, y: bar.y + 2, w: Math.round((bar.w - 4) * this.sync), h: bar.h - 4 },
      this.matched ? '#4f8f57' : '#3a5f42',
    )
    setFont(ctx, 9)
    ctx.fillStyle = DIM
    ctx.fillText('ВЫДЕРЖКА', bar.x, bar.y + bar.h + 12)
    ctx.textAlign = 'right'
    ctx.fillStyle = GREEN
    ctx.fillText(`${Math.round(this.sync * 100)} %`, bar.x + bar.w, bar.y + bar.h + 12)
    ctx.textAlign = 'left'

    // ползунки
    let sy = bar.y + bar.h + 18
    for (const s of this.sliders) {
      const r: Rect = { x: scope.x, y: sy, w: scope.w, h: 20 }
      s.r = r
      fill(ctx, r, '#0b150d')
      ctx.strokeStyle = '#24402a'
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
      // дорожка
      fill(ctx, { x: r.x + 7, y: r.y + r.h / 2 - 1, w: r.w - 14, h: 2 }, '#1d3323')
      // ручка
      const hx = r.x + 7 + (r.w - 14) * s.v
      const handle: Rect = { x: hx - 7, y: r.y + 2, w: 14, h: r.h - 4 }
      panel(ctx, handle, true, 1)
      setFont(ctx, 9)
      ctx.fillStyle = DIM
      ctx.fillText(s.label, r.x + r.w + 10, r.y + r.h / 2 + 3)
      ctx.fillStyle = GREEN
      ctx.textAlign = 'right'
      ctx.fillText(`${Math.round(s.v * 100)}`, r.x - 8, r.y + r.h / 2 + 3)
      ctx.textAlign = 'left'
      sy += r.h + 6
    }
  }

  // ── этап «ЛИНИЯ»: рубильники по паспорту ─────────────────────────

  private drawLine(ctx: CanvasRenderingContext2D, p: Rect): void {
    const pad = 16
    setFont(ctx, 10, true)
    ctx.fillStyle = this.stage === 'won' ? GREEN : AMBER
    ctx.fillText(
      this.stage === 'won' ? 'ПИТАНИЕ ПОДАНО · ЛИНИЯ КАМЕР АКТИВНА' : 'ЭТАП 2 · ПОДАЙ ПИТАНИЕ ПО ЦЕПОЧКЕ',
      p.x + pad,
      p.y + pad + 12,
    )

    if (this.stage === 'won') {
      setFont(ctx, 13, true)
      ctx.fillStyle = GREEN
      ctx.textAlign = 'center'
      ctx.fillText('ЩИТ 3B · ЦЕПЬ ЗАМКНУТА', p.x + p.w / 2, p.y + p.h / 2 - 20)
      setFont(ctx, 10)
      ctx.fillStyle = DIM
      ctx.fillText('узел 01 · ПОСТ ОХРАНЫ — в сети', p.x + p.w / 2, p.y + p.h / 2 + 2)
      ctx.fillText('ретранслятор кухни — в сети', p.x + p.w / 2, p.y + p.h / 2 + 18)
      ctx.textAlign = 'left'
      return
    }

    // порядок из паспорта — крупно и тускло
    setFont(ctx, 12, true)
    ctx.fillStyle = '#8aa38c'
    ctx.fillText(`ПОРЯДОК ВКЛЮЧЕНИЯ:  ${ORDER.join('  →  ')}`, p.x + pad, p.y + pad + 36)
    setFont(ctx, 9)
    ctx.fillStyle = DIM
    ctx.fillText(
      `рубильники на панели перемешаны · аварий: ${this.accidents}`,
      p.x + pad,
      p.y + pad + 52,
    )

    // панель рубильников
    const row: Rect = { x: p.x + pad, y: p.y + pad + 68, w: p.w - pad * 2, h: 220 }
    fill(ctx, row, '#0b150d')
    ctx.strokeStyle = '#24402a'
    ctx.strokeRect(row.x + 0.5, row.y + 0.5, row.w - 1, row.h - 1)

    const n = LAYOUT.length
    const cellW = row.w / n
    for (let i = 0; i < n; i++) {
      const label = LAYOUT[i]
      const cx = row.x + cellW * i + cellW / 2
      const bodyW = Math.min(86, cellW - 28)
      const body: Rect = { x: cx - bodyW / 2, y: row.y + 26, w: bodyW, h: 150 }
      panel(ctx, body, true, 1)
      fill(ctx, { x: body.x + 3, y: body.y + 3, w: body.w - 6, h: body.h - 6 }, '#0a140c')

      // лампа: зелёная, когда рубильник включён
      const lampOn = this.levers[i] === 1
      ctx.fillStyle = lampOn ? '#57c457' : '#3a2f1a'
      ctx.beginPath()
      ctx.arc(body.x + body.w / 2, body.y + 16, 5, 0, Math.PI * 2)
      ctx.fill()
      if (lampOn) {
        ctx.strokeStyle = 'rgba(120, 240, 120, 0.4)'
        ctx.beginPath()
        ctx.arc(body.x + body.w / 2, body.y + 16, 9, 0, Math.PI * 2)
        ctx.stroke()
      }

      // рычаг: вверх — откл, вниз — вкл
      const lever: Rect = { x: body.x + body.w / 2 - 9, y: body.y + 34, w: 18, h: 74 }
      const on = this.levers[i] === 1
      fill(ctx, { x: lever.x + 2, y: lever.y + 2, w: lever.w - 4, h: lever.h - 4 }, '#071009')
      const knob: Rect = {
        x: lever.x + 1,
        y: on ? lever.y + lever.h - 20 : lever.y + 2,
        w: lever.w - 2,
        h: 18,
      }
      panel(ctx, knob, true, 1)

      const hit: Rect = { x: body.x, y: body.y, w: body.w, h: body.h }
      this.leverHits.push({ r: hit, label })
      setFont(ctx, 10, true)
      ctx.fillStyle = lampOn ? GREEN : '#a9c9ae'
      ctx.textAlign = 'center'
      ctx.fillText(label, cx, body.y + body.h + 16)
      ctx.textAlign = 'left'
    }

    // подсказка состояния
    setFont(ctx, 9)
    ctx.fillStyle = DIM
    const progress = ORDER.slice(0, this.done).join(' → ')
    ctx.fillText(
      progress ? `замкнуто: ${progress}${this.done < ORDER.length ? ' → …' : ''}` : 'цепь разомкнута',
      p.x + pad,
      row.y + row.h + 18,
    )
  }
}
