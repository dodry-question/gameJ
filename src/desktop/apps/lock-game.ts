/**
 * «Панель сброса блокировки» — мини-игра на lockreset.local.
 *
 * Схема 5×5 в центре сервер, по ней ползут красные импульсы от заражённых
 * узлов. Курсор ходит по узлам (WASD/стрелки), ПРОБЕЛ на красном узле бьёт
 * по нему (15 ОЗУ за удар). Стоя на узле, глушишь его сигналы. Импульс,
 * дошедший до сервера без игрока, снимает 25% целостности; на нуле контур
 * пробит, замок перезапускается. У сервера батарея заряжается сама, а ПРОБЕЛ
 * в такт расходящейся волне даёт полный заряд сразу; промах коротит панель
 * на две секунды.
 *
 * Игра ничего не знает про браузер и дверь: наружу торчат только onWin.
 */
import { fill, inside, panel, setFont, text, wrap } from '../draw'
import type { Rect } from '../draw'
import type { Sound } from '../../audio'

const COLS = 5
const ROWS = 5
const BASE = { col: 2, row: 2 }

const NODE_HP = 3
const HIT_COST = 15 // ОЗУ за удар
const BATTERY_MAX = 100
const BATTERY_REGEN = 9 // в секунду у сервера
const INTEGRITY_MAX = 100
const DAMAGE = 25 // урон дошедшего импульса
const MOVE_MS = 115 // минимальная пауза между шагами
const EDGE_MS = 1400 // импульс идёт одно ребро схемы
const SPAWN_MS = 6500 // базовый интервал сигналов узла
const WAVE_MS = 1350 // период волны перезарядки
const SHORT_MS = 2000 // короткое замыкание
const WIN_HOLD_MS = 1700

type Cell = { col: number; row: number }
type Infected = Cell & { hp: number; nextSpawn: number }
type Impulse = { path: Cell[]; leg: number; t: number }
type Spark = { x: number; y: number; vx: number; vy: number; born: number }

type State = 'intro' | 'run' | 'won' | 'lost'

const DIRS: Record<string, Cell> = {
  KeyW: { col: 0, row: -1 },
  ArrowUp: { col: 0, row: -1 },
  KeyS: { col: 0, row: 1 },
  ArrowDown: { col: 0, row: 1 },
  KeyA: { col: -1, row: 0 },
  ArrowLeft: { col: -1, row: 0 },
  KeyD: { col: 1, row: 0 },
  ArrowRight: { col: 1, row: 0 },
}

const INTRO_LINES = [
  'Аномальные узлы шлют сигнал блокировки на сервер.',
  'Очисти их, пока целостность контура не упала до нуля.',
  '',
  'WASD / стрелки — ход по схеме',
  'ПРОБЕЛ на красном узле — удар (15 ОЗУ)',
  'стойка на узле глушит его сигналы',
  'у сервера ПРОБЕЛ в такт волне — полный заряд,',
  'промах — короткое замыкание',
]

function keyOf(c: Cell): string {
  return `${c.col}:${c.row}`
}

/** Кратчайший путь по рёбрам схемы от узла к серверу (BFS). */
function pathToBase(from: Cell): Cell[] {
  const prev = new Map<string, string | null>()
  const queue: Cell[] = [from]
  prev.set(keyOf(from), null)
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur.col === BASE.col && cur.row === BASE.row) break
    for (const d of Object.values(DIRS)) {
      const next = { col: cur.col + d.col, row: cur.row + d.row }
      if (next.col < 0 || next.row < 0 || next.col >= COLS || next.row >= ROWS) continue
      const k = keyOf(next)
      if (prev.has(k)) continue
      prev.set(k, keyOf(cur))
      queue.push(next)
    }
  }
  const path: Cell[] = []
  let k: string | null = keyOf(BASE)
  while (k) {
    const [col, row] = k.split(':').map(Number)
    path.unshift({ col, row })
    k = prev.get(k) ?? null
  }
  return path
}

export class LockGame {
  /** Замок снят: браузер передаёт это рабочему столу, тот отпирает дверь. */
  onWin?: () => void

  private sound: Sound
  private state: State = 'intro'
  private infected: Infected[] = []
  private total = 0
  private impulses: Impulse[] = []
  private player: Cell = { ...BASE }
  private battery = BATTERY_MAX
  private integrity = INTEGRITY_MAX
  private held: string[] = []
  private lastMove = 0
  private lastTick = 0
  /** Нажатие, попавшее в гейт частоты: выполняется сразу, как шаг станет возможен. */
  private buffered: { code: string; at: number } | null = null
  /** Игрок стоит на сервере: подсветка защиты. */
  private atBase = false
  /** Индекс заражённого узла под курсором: он глушит сигналы. */
  private muting = -1
  private wave = -1 // доля цикла волны, -1 — волны нет
  private frozenUntil = 0
  private sparks: Spark[] = []
  private damageAt = 0
  private shakeUntil = 0
  private absorbAt = 0
  private wonAt = 0
  private winSent = false
  private msg = ''
  private msgUntil = 0
  private startBtn: Rect | null = null
  /** Геометрия последнего кадра — для отрисовки вспышек вне draw(). */
  private geo = { step: 60, ox: 0, oy: 0, ring: 18 }

  constructor(sound: Sound) {
    this.sound = sound
    this.layout(4)
    ;(window as unknown as { __lock?: LockGame }).__lock = this
    window.addEventListener('keyup', (e) => {
      const i = this.held.indexOf(e.code)
      if (i >= 0) this.held.splice(i, 1)
    })
    window.addEventListener('blur', () => {
      this.held = []
    })
  }

  // ── состояние для tools/ ─────────────────────────────────────────

  debugState(): object {
    return {
      state: this.state,
      battery: Math.round(this.battery),
      integrity: Math.round(this.integrity),
      cleared: this.total - this.infected.length,
      total: this.total,
      player: { ...this.player },
      infected: this.infected.map((n) => ({ col: n.col, row: n.row, hp: n.hp })),
      impulses: this.impulses.length,
      frozen: performance.now() < this.frozenUntil,
      waveR: this.wave >= 0 ? this.wave * this.geo.step * 1.35 : -1,
      ringR: this.geo.ring,
    }
  }

  /** Отладочный прыжок курсора (только инструменты проверки). */
  debugJump(col: number, row: number): void {
    this.player = { col, row }
  }

  /** Отладочная очистка летящих импульсов — чтобы проверка была детерминированной. */
  debugClear(): void {
    this.impulses = []
  }

  // ── раскладка ────────────────────────────────────────────────────

  private layout(count: number): void {
    // Узлы стараемся раскидать подальше от сервера и друг от друга; если
    // не вышло — ослабляем требования, лишь бы набрать нужное количество.
    const cells: Cell[] = []
    for (let relax = 0; relax <= 2 && cells.length < count; relax++) {
      for (let attempt = 0; attempt < 60 && cells.length < count; attempt++) {
        const c: Cell = { col: rand(COLS), row: rand(ROWS) }
        const far = Math.max(Math.abs(c.col - BASE.col), Math.abs(c.row - BASE.row))
        if (far < (relax === 0 ? 2 : 1)) continue
        const minGap = relax === 0 ? 2 : relax === 1 ? 1 : 0
        if (cells.some((o) => Math.max(Math.abs(o.col - c.col), Math.abs(o.row - c.row)) < Math.max(1, minGap))) continue
        cells.push(c)
      }
    }
    this.infected = cells.map((c) => ({ ...c, hp: NODE_HP, nextSpawn: 0 }))
    this.total = this.infected.length
    this.impulses = []
    this.player = { ...BASE }
    this.battery = BATTERY_MAX
    this.integrity = INTEGRITY_MAX
    this.wave = -1
    this.frozenUntil = 0
    this.sparks = []
    this.winSent = false
    this.state = 'intro'
  }

  private restart(): void {
    this.layout(3 + rand(3))
    this.state = 'intro'
  }

  // ── жизненный цикл ───────────────────────────────────────────────

  tick(): boolean {
    const now = performance.now()
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000))
    this.lastTick = now
    if (this.state !== 'run' && this.state !== 'won') return false

    if (this.state === 'won') {
      if (!this.winSent && now - this.wonAt >= WIN_HOLD_MS) {
        this.winSent = true
        this.onWin?.()
      }
      return true
    }

    // ходьба: удержание шагает с ограничением частоты
    if (this.held.length > 0 && now >= this.lastMove + MOVE_MS) {
      this.tryMove(DIRS[this.held[this.held.length - 1]])
    }
    // отложенное нажатие: не пропало, а ждало своей очереди
    if (this.buffered) {
      if (now - this.buffered.at > 100 || !this.held.includes(this.buffered.code)) {
        this.buffered = null
      } else if (now >= this.lastMove + MOVE_MS) {
        this.tryMove(DIRS[this.buffered.code])
        this.buffered = null
      }
    }

    this.atBase = this.player.col === BASE.col && this.player.row === BASE.row
    this.muting = this.infected.findIndex(
      (n) => n.col === this.player.col && n.row === this.player.row,
    )
    const atBase = this.atBase
    const frozen = now < this.frozenUntil

    // батарея: медленная подзарядка у сервера
    if (atBase && !frozen && this.battery < BATTERY_MAX) {
      this.battery = Math.min(BATTERY_MAX, this.battery + BATTERY_REGEN * dt)
    }

    // волна перезарядки расходится сама, пока стоишь на сервере не полностью заряжен
    if (atBase && !frozen && this.battery < BATTERY_MAX) {
      if (this.wave < 0) this.wave = 0
      this.wave += dt / (WAVE_MS / 1000)
      if (this.wave >= 1) this.wave = 0
    } else if (!atBase || this.battery >= BATTERY_MAX) {
      this.wave = -1
    }

    // импульсы ползут к серверу
    for (const imp of this.impulses) {
      imp.t += (dt * 1000) / EDGE_MS
      while (imp.t >= 1 && imp.leg < imp.path.length - 2) {
        imp.t -= 1
        imp.leg++
      }
    }
    for (const imp of [...this.impulses]) {
      if (imp.t >= 1 && imp.leg >= imp.path.length - 2) {
        this.impulses.splice(this.impulses.indexOf(imp), 1)
        if (atBase) {
          this.absorbAt = now
          this.sound.impulseAbsorbed()
        } else {
          this.integrity = Math.max(0, this.integrity - DAMAGE)
          this.damageAt = now
          this.shakeUntil = now + 350
          this.sound.impulseBreach()
          if (this.integrity <= 0) {
            this.state = 'lost'
            this.sound.error()
            return true
          }
        }
      }
    }

    // заражённые узлы выслали импульсы; под игроком узел молчит
    if (!frozen) {
      const panic = 0.55 + (0.45 * this.infected.length) / Math.max(1, this.total)
      for (const node of this.infected) {
        const occupied = node.col === this.player.col && node.row === this.player.row
        if (node.nextSpawn === 0) {
          node.nextSpawn = now + 2600 + rand(4) * 700
          continue
        }
        if (!occupied && now >= node.nextSpawn) {
          node.nextSpawn = now + SPAWN_MS * panic * (0.85 + Math.random() * 0.3)
          this.impulses.push({ path: pathToBase(node), leg: 0, t: 0 })
          this.sound.impulsePing()
        }
      }
    }

    // искры короткого замыкания
    if (this.sparks.length > 0) {
      for (const s of this.sparks) {
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.vy += 60 * dt
      }
      this.sparks = this.sparks.filter((s) => now - s.born < 900)
    }

    if (this.msg && now >= this.msgUntil) this.msg = ''
    return true
  }

  key(e: KeyboardEvent): boolean {
    const dir = DIRS[e.code]
    if (dir) {
      if (e.repeat) return true // шаги идут от held-цикла, системный повтор лишний
      if (!this.held.includes(e.code)) this.held.push(e.code)
      const now = performance.now()
      if (this.state === 'run' && now >= this.lastMove + MOVE_MS) this.tryMove(dir)
      else if (this.state === 'run') this.buffered = { code: e.code, at: now }
      return true
    }
    if (e.code !== 'Space' || e.repeat) return false
    if (this.state === 'intro') {
      this.state = 'run'
      this.lastTick = performance.now()
      this.sound.click()
      return true
    }
    if (this.state === 'lost') {
      this.restart()
      this.sound.click()
      return true
    }
    if (this.state === 'run') {
      this.action()
      return true
    }
    return false
  }

  click(x: number, y: number): boolean {
    if (this.state === 'intro' && this.startBtn && inside(this.startBtn, x, y)) {
      this.state = 'run'
      this.lastTick = performance.now()
      this.sound.click()
      return true
    }
    return false
  }

  // ── действия ─────────────────────────────────────────────────────

  private tryMove(d: Cell): void {
    if (this.state !== 'run') return
    const now = performance.now()
    if (now < this.frozenUntil) return
    const col = this.player.col + d.col
    const row = this.player.row + d.row
    this.lastMove = now
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return
    this.player = { col, row }
    this.sound.step()
  }

  /** ПРОБЕЛ: удар по узлу под курсором или попытка перезарядки у сервера. */
  private action(): void {
    const now = performance.now()
    if (now < this.frozenUntil) return
    const node = this.infected.find((n) => n.col === this.player.col && n.row === this.player.row)
    if (node) {
      if (this.battery < HIT_COST) {
        this.say('НЕТ ЗАРЯДА · БЕГИ К СЕРВЕРУ', 1800)
        this.sound.deny()
        return
      }
      this.battery -= HIT_COST
      node.hp--
      if (node.hp <= 0) {
        this.infected.splice(this.infected.indexOf(node), 1)
        this.sound.nodeCleared()
        if (this.infected.length === 0) {
          this.state = 'won'
          this.wonAt = now
          this.sound.lockReleased()
        }
      } else {
        this.sound.zapHit()
      }
      return
    }

    const atBase = this.player.col === BASE.col && this.player.row === BASE.row
    if (!atBase || this.battery >= BATTERY_MAX || this.wave < 0) return
    const radius = this.wave * this.geo.step * 1.35
    if (Math.abs(radius - this.geo.ring) <= this.geo.ring * 0.42) {
      this.battery = BATTERY_MAX
      this.wave = -1
      this.absorbAt = now
      this.sound.reloadPerfect()
    } else {
      this.frozenUntil = now + SHORT_MS
      this.wave = -1
      this.sound.shortZap()
      this.sparks = []
      const { ox, oy } = this.cellXY(BASE)
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2
        const v = 40 + Math.random() * 130
        this.sparks.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, born: now })
      }
    }
  }

  private say(msg: string, ms: number): void {
    this.msg = msg
    this.msgUntil = performance.now() + ms
  }

  // ── отрисовка ────────────────────────────────────────────────────

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, '#07120b')

    const now = performance.now()
    const shake = now < this.shakeUntil ? (Math.random() - 0.5) * 5 : 0
    ctx.save()
    ctx.translate(shake, shake)

    const hudTop = 30
    const hudBottom = 44
    const gw = r.w - 32
    const gh = r.h - hudTop - hudBottom - 12
    const step = Math.min(gw / (COLS - 1), gh / (ROWS - 1), 96)
    const ox = r.x + (r.w - step * (COLS - 1)) / 2
    const oy = r.y + hudTop + 8 + (gh - step * (ROWS - 1)) / 2
    this.geo = { step, ox, oy, ring: step * 0.3 }

    this.drawLinks(ctx, ox, oy, step)
    this.drawBase(ctx, ox, oy, step, now)
    this.infected.forEach((node, i) =>
      this.drawInfected(ctx, node, ox, oy, step, now, i === this.muting),
    )
    for (const imp of this.impulses) this.drawImpulse(ctx, imp, ox, oy, step)
    if (this.state !== 'intro') this.drawPlayer(ctx, ox, oy, step, now)
    if (this.sparks.length > 0) this.drawSparks(ctx)

    ctx.restore()

    this.drawHud(ctx, r, now)
    if (now < this.damageAt + 450) {
      ctx.fillStyle = `rgba(180, 32, 24, ${(0.4 * (1 - (now - this.damageAt) / 450)).toFixed(3)})`
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }
    if (this.state === 'intro') this.drawIntro(ctx, r)
    if (this.state === 'won') this.drawWon(ctx, r, now)
    if (this.state === 'lost') this.drawLost(ctx, r)
  }

  private cellXY(c: Cell): { ox: number; oy: number } {
    return { ox: this.geo.ox + c.col * this.geo.step, oy: this.geo.oy + c.row * this.geo.step }
  }

  /** Линии схемы: тусклая сетка соединений. */
  private drawLinks(ctx: CanvasRenderingContext2D, ox: number, oy: number, step: number): void {
    ctx.strokeStyle = 'rgba(126, 154, 132, 0.3)'
    ctx.lineWidth = 1
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = ox + col * step
        const y = oy + row * step
        if (col + 1 < COLS) {
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + step, y)
          ctx.stroke()
        }
        if (row + 1 < ROWS) {
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x, y + step)
          ctx.stroke()
        }
      }
    }
    // засечки на перекрёстках, как на охранной схеме
    ctx.fillStyle = 'rgba(126, 154, 132, 0.5)'
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        ctx.fillRect(ox + col * step - 1, oy + row * step - 1, 2, 2)
      }
    }
  }

  private drawBase(ctx: CanvasRenderingContext2D, ox: number, oy: number, step: number, now: number): void {
    const cx = ox + BASE.col * step
    const cy = oy + BASE.row * step
    const ring = step * 0.3
    const atBase = this.player.col === BASE.col && this.player.row === BASE.row

    // волна перезарядки
    if (this.wave >= 0 && this.state === 'run') {
      const radius = this.wave * step * 1.35
      const inTime = Math.abs(radius - ring) <= ring * 0.42
      ctx.strokeStyle = inTime ? 'rgba(220, 255, 220, 0.9)' : `rgba(159, 211, 159, ${(0.75 * (1 - this.wave * 0.6)).toFixed(3)})`
      ctx.lineWidth = inTime ? 2.5 : 1.5
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
    }

    // кольцо сервера; вспышка при поглощении импульса и удачной перезарядке
    const flash = now < this.absorbAt + 300 ? 1 - (now - this.absorbAt) / 300 : 0
    if (flash > 0) {
      ctx.strokeStyle = `rgba(190, 255, 200, ${flash.toFixed(3)})`
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(cx, cy, ring + 6 * (1 - flash), 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
    }
    ctx.strokeStyle = atBase ? '#c6f0c6' : '#9fd39f'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(cx, cy, ring, 0, Math.PI * 2)
    ctx.stroke()
    // контракт: стоишь на сервере — видно, что импульсы гасятся здесь
    if (atBase && this.state === 'run') {
      const pulse = 0.5 + 0.5 * Math.sin(now / 170)
      ctx.strokeStyle = `rgba(190, 255, 200, ${(0.25 + pulse * 0.35).toFixed(3)})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, ring + 5 + pulse * 3, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
      text(ctx, 'ПОГЛОЩЕНИЕ', cx, cy - ring - 12, {
        size: 8,
        bold: true,
        color: '#c6f0c6',
        align: 'center',
      })
    }
    ctx.lineWidth = 1
    ctx.fillStyle = atBase ? '#1f3a26' : '#13291a'
    ctx.beginPath()
    ctx.arc(cx, cy, ring - 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#9fd39f'
    ctx.fillRect(cx - 3, cy - 3, 6, 6)

    setFont(ctx, 8)
    ctx.fillStyle = 'rgba(159, 211, 159, 0.75)'
    ctx.textAlign = 'center'
    ctx.fillText('СЕРВЕР', cx, cy + ring + 9)
    ctx.textAlign = 'left'
  }

  private drawInfected(ctx: CanvasRenderingContext2D, node: Infected, ox: number, oy: number, step: number, now: number, muting = false): void {
    const cx = ox + node.col * step
    const cy = oy + node.row * step
    const blink = Math.floor(now / 500) % 2 === 0 ? 1 : 0.45

    // контракт: курсор на узле — его сигналы заглушены, видно сразу
    if (muting) {
      ctx.strokeStyle = '#c6f0c6'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, 10, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
      ctx.strokeStyle = '#c6f0c6'
      ctx.beginPath()
      ctx.moveTo(cx - 6, cy)
      ctx.lineTo(cx + 6, cy)
      ctx.stroke()
      text(ctx, 'ГЛУШИТ', cx, cy - 20, {
        size: 8,
        bold: true,
        color: '#c6f0c6',
        align: 'center',
      })
    }

    const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 14)
    glow.addColorStop(0, `rgba(212, 64, 46, ${(0.4 * blink).toFixed(3)})`)
    glow.addColorStop(1, 'rgba(212, 64, 46, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(cx - 14, cy - 14, 28, 28)

    ctx.fillStyle = `rgba(212, 64, 46, ${blink.toFixed(3)})`
    ctx.beginPath()
    ctx.arc(cx, cy, 5, 0, Math.PI * 2)
    ctx.fill()

    // здоровье узла: красные сегменты сверху
    const segW = 6
    for (let i = 0; i < NODE_HP; i++) {
      const x = cx - (NODE_HP * segW + (NODE_HP - 1) * 2) / 2 + i * (segW + 2)
      ctx.fillStyle = i < node.hp ? '#d4402e' : 'rgba(212, 64, 46, 0.2)'
      ctx.fillRect(x, cy - 14, segW, 3)
    }
  }

  private drawImpulse(ctx: CanvasRenderingContext2D, imp: Impulse, ox: number, oy: number, step: number): void {
    // подсветка ребра, по которому ползёт сигнал
    const a = imp.path[imp.leg]
    const b = imp.path[imp.leg + 1]
    if (a && b) {
      ctx.strokeStyle = 'rgba(212, 64, 46, 0.5)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(ox + a.col * step, oy + a.row * step)
      ctx.lineTo(ox + b.col * step, oy + b.row * step)
      ctx.stroke()
      ctx.lineWidth = 1
    }
    // хвост из затухающих точек
    for (let k = 4; k >= 0; k--) {
      const t = imp.t - k * 0.09
      if (t < 0) continue
      const x = ox + (a.col + (b.col - a.col) * t) * step
      const y = oy + (a.row + (b.row - a.row) * t) * step
      ctx.fillStyle = `rgba(232, 82, 58, ${(0.85 - k * 0.16).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(x, y, k === 0 ? 4 : 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, ox: number, oy: number, step: number, now: number): void {
    const pulse = 0.8 + Math.sin(now / 180) * 0.2
    const frozen = now < this.frozenUntil
    const x = ox + this.player.col * step
    const y = oy + this.player.row * step
    const s = 5 + pulse * (frozen ? 0 : 1.5)

    ctx.fillStyle = frozen ? '#8f948d' : `rgba(255, 255, 255, ${pulse.toFixed(3)})`
    ctx.fillRect(x - s, y - s, s * 2, s * 2)
    ctx.strokeStyle = frozen ? '#5c6158' : '#ffffff'
    ctx.strokeRect(x - s - 1.5, y - s - 1.5, s * 2 + 3, s * 2 + 3)

    const node = this.infected.find((n) => n.col === this.player.col && n.row === this.player.row)
    if (node && this.state === 'run') {
      setFont(ctx, 8)
      ctx.fillStyle = 'rgba(216, 178, 90, 0.9)'
      ctx.textAlign = 'center'
      ctx.fillText('СИГНАЛ ЗАГЛУШЕН', x, y + step * 0.32)
      ctx.textAlign = 'left'
    }
  }

  private drawSparks(ctx: CanvasRenderingContext2D): void {
    for (const s of this.sparks) {
      ctx.strokeStyle = `rgba(255, 214, 120, ${Math.max(0, 1 - (performance.now() - s.born) / 900).toFixed(3)})`
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(s.x - s.vx * 0.03, s.y - s.vy * 0.03)
      ctx.stroke()
    }
  }

  // ── HUD и оверлеи ────────────────────────────────────────────────

  private bar(ctx: CanvasRenderingContext2D, r: Rect, p: number, color: string): void {
    panel(ctx, r, false, 1)
    fill(ctx, { x: r.x + 2, y: r.y + 2, w: Math.max(0, Math.round((r.w - 4) * p)), h: r.h - 4 }, color)
  }

  private drawHud(ctx: CanvasRenderingContext2D, r: Rect, now: number): void {
    // верх: целостность контура и счёт узлов
    setFont(ctx, 9)
    ctx.fillStyle = '#7e8c80'
    ctx.fillText('ЦЕЛОСТНОСТЬ', r.x + 12, r.y + 15)
    const seg: Rect = { x: r.x + 88, y: r.y + 8, w: 128, h: 13 }
    panel(ctx, seg, false, 1)
    const filled = Math.ceil(this.integrity / DAMAGE - 0.001)
    for (let i = 0; i < 4; i++) {
      const cell: Rect = { x: seg.x + 2 + i * 31, y: seg.y + 2, w: 29, h: seg.h - 4 }
      fill(ctx, cell, i < filled ? (this.integrity <= 50 ? '#c9a227' : '#4f8f57') : '#22261f')
    }
    ctx.textAlign = 'right'
    ctx.fillStyle = this.state === 'won' ? '#9fd39f' : '#d8b25a'
    ctx.fillText(
      this.state === 'won' ? 'ЗАМОК СНЯТ' : `УЗЛЫ: ${this.total - this.infected.length}/${this.total}`,
      r.x + r.w - 12,
      r.y + 15,
    )
    ctx.textAlign = 'left'

    // низ: ОЗУ и подсказка
    const footY = r.y + r.h - 26
    setFont(ctx, 9)
    ctx.fillStyle = '#7e8c80'
    ctx.fillText('ОЗУ', r.x + 12, footY + 7)
    const level = this.battery / BATTERY_MAX
    const color = level > 0.5 ? '#4f8f57' : level > 0.25 ? '#c9a227' : '#b23a2e'
    this.bar(ctx, { x: r.x + 40, y: footY, w: 190, h: 14 }, level, color)
    setFont(ctx, 9)
    ctx.fillStyle = '#c9ccc6'
    ctx.fillText(`${Math.round(this.battery)}%`, r.x + 238, footY + 7)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#5f6f62'
    ctx.fillText('WASD — ХОД · ПРОБЕЛ — УДАР / ЗАРЯД', r.x + r.w - 12, footY + 7)
    ctx.textAlign = 'left'

    // контекстная строка над панелью ОЗУ
    const atBase = this.player.col === BASE.col && this.player.row === BASE.row
    const line = this.msg
      ? this.msg
      : now < this.frozenUntil
        ? 'КОРОТКОЕ ЗАМЫКАНИЕ · ПАНЕЛЬ ЗАВИСЛА'
        : atBase && this.battery < BATTERY_MAX && this.state === 'run'
          ? 'ПЕРЕЗАРЯДКА · ПРОБЕЛ В ТАКТ ВОЛНЕ — ПОЛНЫЙ ЗАРЯД'
          : ''
    if (line) {
      setFont(ctx, 9)
      ctx.fillStyle = now < this.frozenUntil ? '#d47a5a' : '#d8b25a'
      ctx.textAlign = 'center'
      ctx.fillText(line, r.x + r.w / 2, footY - 10)
      ctx.textAlign = 'left'
    }
  }

  private veil(ctx: CanvasRenderingContext2D, r: Rect): void {
    ctx.fillStyle = 'rgba(4, 10, 6, 0.82)'
    ctx.fillRect(r.x, r.y, r.w, r.h)
  }

  private drawIntro(ctx: CanvasRenderingContext2D, r: Rect): void {
    this.veil(ctx, r)
    const w = Math.min(430, r.w - 30)
    const h = 232
    const p: Rect = { x: r.x + (r.w - w) / 2, y: r.y + Math.max(14, (r.h - h) / 2 - 12), w, h }
    panel(ctx, p, true, 2)

    text(ctx, 'ЗАМОК ДВЕРИ ЗАРАЖЕН', p.x + w / 2, p.y + 24, {
      size: 15,
      bold: true,
      color: '#8a1c1c',
      align: 'center',
    })
    let y = p.y + 52
    for (const line of INTRO_LINES) {
      for (const part of wrap(ctx, line, w - 48, 11)) {
        text(ctx, part, p.x + 24, y, { size: 11 })
        y += 15
      }
      if (!line) y += 4
    }

    const btn: Rect = { x: p.x + w / 2 - 92, y: p.y + p.h - 38, w: 184, h: 26 }
    panel(ctx, btn, true, 1)
    text(ctx, 'ПРОБЕЛ — ЗАПУСК СБРОСА', btn.x + btn.w / 2, btn.y + btn.h / 2, {
      size: 11,
      bold: true,
      align: 'center',
    })
    this.startBtn = btn
  }

  private drawWon(ctx: CanvasRenderingContext2D, r: Rect, now: number): void {
    this.veil(ctx, r)
    const a = Math.min(1, (now - this.wonAt) / 400)
    ctx.globalAlpha = a
    text(ctx, 'БЛОКИРОВКА СНЯТА', r.x + r.w / 2, r.y + r.h / 2 - 12, {
      size: 20,
      bold: true,
      color: '#9fd39f',
      align: 'center',
    })
    text(ctx, 'команда отпирания ушла на дверь', r.x + r.w / 2, r.y + r.h / 2 + 16, {
      size: 11,
      color: '#7e8c80',
      align: 'center',
    })
    ctx.globalAlpha = 1
  }

  private drawLost(ctx: CanvasRenderingContext2D, r: Rect): void {
    this.veil(ctx, r)
    text(ctx, 'СИГНАЛ ДОШЁЛ ДО СЕРВЕРА', r.x + r.w / 2, r.y + r.h / 2 - 34, {
      size: 18,
      bold: true,
      color: '#b23a2e',
      align: 'center',
    })
    text(ctx, 'контур пробит · замок перезапущен', r.x + r.w / 2, r.y + r.h / 2 - 8, {
      size: 11,
      color: '#c9ccc6',
      align: 'center',
    })
    const btn: Rect = { x: r.x + r.w / 2 - 92, y: r.y + r.h / 2 + 18, w: 184, h: 26 }
    panel(ctx, btn, true, 1)
    text(ctx, 'ПРОБЕЛ — ПОВТОРИТЬ', btn.x + btn.w / 2, btn.y + btn.h / 2, {
      size: 11,
      bold: true,
      align: 'center',
    })
  }
}

function rand(n: number): number {
  return Math.floor(Math.random() * n)
}
