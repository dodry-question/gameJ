/**
 * Экран камеры 04 внутри терминала TDS.
 *
 * Картинка не появляется мгновенно: сначала сверху вниз проявляется мутный
 * кадр, потом он очищается — как медленный поток по узкому каналу. Кнопки
 * замка оживают только после полной загрузки. Сцену камеры двигает TDS,
 * сам экран её не обновляет.
 */
import { fill, inside, panel, setFont, text, wrap } from '../draw'
import type { Rect } from '../draw'
import type { Sound } from '../../audio'
import { getCctv } from '../../cctv'
import type { Cctv } from '../../cctv'

type Phase = 'locked' | 'ready' | 'untied' | 'open'
type Hit = { r: Rect; fn: () => void }
type MenuItem = { r: Rect; id: string; action: string; label: string }

/** Сколько идёт «приём» картинки. */
const REVEAL_MS = 2600
const FEED_W = 320
const FEED_H = 240

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export class CameraFeed {
  private hits: Hit[] = []
  private sound: Sound
  private cctv: Cctv | null = null
  private phase: Phase = 'locked'
  private t = 0
  private startedAt = 0
  private released = 0
  private debugGirl = false
  private debugDoor = false
  private debugKitchen = false
  private noise: HTMLCanvasElement
  /** Какой канал смотрим: 04 — комната 4, 05 — кухня. */
  private channel: '04' | '05' = '04'
  /** Режим скана (TAB): рамки и подписи на объектах кухни. */
  private scan = false
  /** Открытое меню команд: точка на экране и строки. */
  private menu: { x: number; y: number; id: string; items: Array<{ label: string; action: string }> } | null = null
  private menuHit: MenuItem[] = []
  private feedRect: Rect | null = null

  /**
   * Кнопка «Открыть дверь» больше не отпирает замок сама: терминал выдаёт
   * адрес панели сброса. Если колбэка нет — работаем по-старому.
   */
  onUnlock?: () => void

  constructor(sound: Sound) {
    this.sound = sound
    this.noise = this.makeNoise()
  }

  /** Доступ к замку открывается после прочтения письма. */
  setAccess(allowed: boolean): void {
    if (this.phase === 'open') return
    this.phase = allowed ? 'ready' : 'locked'
  }

  get releasedGirl(): boolean {
    return this.phase === 'open'
  }

  /** Канал, который сейчас подключён — для подписей в шапке. */
  get channelNow(): '04' | '05' {
    return this.channel
  }

  /** Узел на карте выбран: переключаем ракурс сцены. */
  setChannel(ch: '04' | '05'): void {
    if (this.channel === ch) return
    this.channel = ch
    this.cctv?.setView(ch)
  }

  /** Замок снят (в браузере или отладчиком): дверь отпирается. */
  unlock(): void {
    if (this.phase === 'open') return
    const wasUntied = this.phase === 'untied'
    this.phase = 'open'
    this.released = 0
    // выпуск только если она уже отвязана: переоткрытый терминал не должен
    // возвращать девушку к стулу
    if (wasUntied) {
      this.cctv?.release()
      this.sound.open()
    }
  }

  /** Начать приём картинки заново. */
  start(): void {
    this.startedAt = performance.now()
    this.released = 0
  }

  /** Отладочный вход: картинка уже принята. */
  startNow(): void {
    this.startedAt = performance.now() - REVEAL_MS
  }

  stop(): void {
    this.startedAt = 0
    this.sound.setBreathing(null)
  }

  private get reveal(): number {
    if (!this.startedAt) return 0
    return clamp((performance.now() - this.startedAt) / REVEAL_MS, 0, 1)
  }

  get ready(): boolean {
    return this.reveal >= 1
  }

  private makeNoise(): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 128
    const ctx = c.getContext('2d')
    if (ctx) {
      const img = ctx.createImageData(128, 128)
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 120 + Math.random() * 135
        img.data[i] = v
        img.data[i + 1] = v
        img.data[i + 2] = v
        img.data[i + 3] = 26
      }
      ctx.putImageData(img, 0, 0)
    }
    return c
  }

  /**
   * active — экран камеры сейчас виден. Дыхание звучит только на нём, а
   * сценарий выпуска продолжает идти, даже если игрок ушёл на карту.
   */
  tick(active: boolean): boolean {
    const cctv = this.cctv ?? (this.cctv = getCctv())
    this.t += 0.016

    // Отладка: ?girl — девушку отвязывают сразу, ?door — сразу открывают дверь,
    // ?kitchen — сразу отправляют в кухню (для инструментов).
    if (cctv.loaded) {
      if (!this.debugGirl && location.search.includes('girl')) {
        this.debugGirl = true
        this.phase = 'untied'
        cctv.untie()
      }
      if (!this.debugDoor && location.search.includes('door')) {
        this.debugDoor = true
        this.phase = 'open'
        this.released = 0
        cctv.release()
      }
      if (!this.debugKitchen && location.search.includes('kitchen')) {
        this.debugKitchen = true
        this.phase = 'untied'
        cctv.debugToKitchen()
      }
    }

    if (this.phase === 'open') {
      this.released += 0.016
      // Порог ухода в темноту переехал в cctv: там она сворачивает в кухню
      // и появляется в кадре КАМ-05. Здесь только страховка от застревания.
      if (this.released > 15 && cctv.girlState === 'run') cctv.setState('gone')
    }

    // дыхание девушки: слышно, пока виден кадр, и чем больше стресс, тем чаще
    const audible = active && this.ready && this.phase !== 'open' && cctv.loaded && !cctv.gone
    this.sound.setBreathing(audible ? cctv.stress : null)

    // события кухни → звуки ленты: дверь приняла или отказала
    if (cctv.events.length > 0) {
      for (const ev of cctv.events.splice(0)) {
        if (ev === 'doorDeny') this.sound.error()
        else if (ev === 'doorOk') this.sound.open()
      }
    }
    return true
  }

  /** TAB на кухне: включить/выключить подсветку объектов. */
  key(e: KeyboardEvent): boolean {
    if (e.code === 'Tab' && !e.repeat && this.channel === '05' && this.ready) {
      this.scan = !this.scan
      if (!this.scan) this.menu = null
      this.sound.click()
      return true
    }
    return false
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    this.hits = []
    fill(ctx, r, '#1b1d1f')

    const cctv = this.cctv ?? (this.cctv = getCctv())
    const ready = this.ready

    // ── рамка записи ────────────────────────────────────────────────
    const head: Rect = { x: r.x + 8, y: r.y + 6, w: r.w - 16, h: 18 }
    const footH = 40
    const availW = r.w - 20
    const availH = r.h - 30 - footH
    let fw = Math.min(availW, Math.round((availH * 4) / 3))
    let fh = Math.round((fw * 3) / 4)
    if (fh > availH) {
      fh = availH
      fw = Math.round((fh * 4) / 3)
    }
    const feed: Rect = {
      x: r.x + Math.round((r.w - fw) / 2),
      y: head.y + head.h + 2,
      w: fw,
      h: fh,
    }

    fill(ctx, feed, '#000000')
    if (!ready) {
      this.loading(ctx, feed)
    } else if (cctv.loaded) {
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(cctv.canvas, feed.x, feed.y, feed.w, feed.h)
      ctx.restore()
      this.overlay(ctx, feed)
      if (this.channel === '05') this.kitchenUi(ctx, feed, cctv)
    } else {
      text(ctx, 'НЕТ СИГНАЛА', feed.x + feed.w / 2, feed.y + feed.h / 2, {
        size: 14,
        bold: true,
        color: '#8f948d',
        align: 'center',
      })
    }

    ctx.strokeStyle = '#3c4044'
    ctx.strokeRect(feed.x + 0.5, feed.y + 0.5, feed.w - 1, feed.h - 1)
    this.feedRect = feed

    // ── шапка записи ────────────────────────────────────────────────
    setFont(ctx, 11, true)
    ctx.fillStyle = '#8fd08f'
    ctx.textBaseline = 'middle'
    const camLabel = this.channel === '05' ? 'CAM 05' : 'CAM 04'
    const placeLabel = this.channel === '05' ? 'КУХНЯ, БЛОК C' : 'КОМНАТА 4, БЛОК C'
    ctx.fillText(camLabel, head.x + 2, head.y + head.h / 2)
    ctx.fillStyle = '#c9ccc6'
    ctx.fillText(`· ${placeLabel}`, head.x + 62, head.y + head.h / 2)

    if (ready && Math.floor(this.t * 2) % 2 === 0) {
      ctx.fillStyle = '#c0392b'
      ctx.beginPath()
      ctx.arc(head.x + head.w - 46, head.y + head.h / 2, 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#c9ccc6'
    ctx.textAlign = 'right'
    ctx.fillText(ready ? 'ЗАПИСЬ' : 'КАНАЛ', head.x + head.w - 2, head.y + head.h / 2)
    ctx.textAlign = 'left'

    // ── нижняя полоса ───────────────────────────────────────────────
    if (!ready) {
      const pct = Math.round(this.reveal * 100)
      text(ctx, `приём картинки · ${pct}%`, r.x + 10, r.y + r.h - 22, {
        size: 11,
        color: '#8f948d',
      })
      return
    }

    // кнопка слева: уведомление почты в правом нижнем углу не перекрывает её
    const btn: Rect = { x: r.x + 10, y: r.y + r.h - 40, w: 202, h: 30 }
    const enabled = this.phase === 'ready' || this.phase === 'untied'
    panel(ctx, btn, enabled, 2)
    setFont(ctx, 13, true)
    ctx.fillStyle = enabled ? '#1d3a1d' : '#6d6d66'
    ctx.textAlign = 'center'
    const label =
      this.phase === 'locked'
        ? 'ЗАБЛОКИРОВАНО'
        : this.phase === 'ready'
          ? 'ОТВЯЗАТЬ'
          : this.phase === 'untied'
            ? 'ОТКРЫТЬ ДВЕРЬ'
            : 'ДВЕРЬ ОТКРЫТА'
    ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2)
    ctx.textAlign = 'left'

    text(ctx, 'пульт: клавиша 04 · поток 12 к/с', r.x + r.w - 10, r.y + r.h - 22, {
      size: 11,
      color: '#6f746d',
      align: 'right',
    })

    if (this.phase === 'ready') {
      this.hits.push({
        r: btn,
        fn: () => {
          this.phase = 'untied'
          this.cctv?.untie()
          this.sound.open()
        },
      })
    } else if (this.phase === 'untied') {
      this.hits.push({
        r: btn,
        fn: () => {
          if (this.onUnlock) this.onUnlock()
          else this.unlock()
        },
      })
    }
  }

  /** Проявление кадра сверху вниз: мутные полосы, шум и счётчик. */
  private loading(ctx: CanvasRenderingContext2D, f: Rect): void {
    const p = this.reveal
    const cctv = this.cctv

    if (cctv?.loaded) {
      const shownH = Math.max(2, Math.round(f.h * (0.12 + 0.88 * p)))
      ctx.save()
      ctx.beginPath()
      ctx.rect(f.x, f.y, f.w, shownH)
      ctx.clip()
      ctx.globalAlpha = 0.25 + 0.75 * p
      const blur = (1 - p) * 6
      ctx.imageSmoothingEnabled = false
      ctx.filter = blur > 0.4 ? `blur(${blur.toFixed(1)}px)` : 'none'
      ctx.drawImage(cctv.canvas, 0, 0, FEED_W, FEED_H, f.x, f.y, f.w, f.h)
      ctx.filter = 'none'

      // редкие сдвинутые полосы помех, пока кадр не собрался
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = (1 - p) * 0.35
      for (let i = 0; i < 3; i++) {
        const sy = f.y + ((this.t * 97 + i * 137) % Math.max(1, shownH))
        const sh = 4 + (i % 2) * 6
        const dx = ((i * 7 + Math.floor(this.t * 9)) % 9) - 4
        ctx.drawImage(this.noise, f.x + dx, sy, f.w, sh, f.x, sy, f.w, sh)
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.restore()
    }

    // шум и затемнение не принятой части
    ctx.save()
    ctx.beginPath()
    ctx.rect(f.x, f.y, f.w, f.h)
    ctx.clip()
    ctx.globalAlpha = 0.35
    ctx.drawImage(this.noise, f.x, f.y, f.w, f.h)
    ctx.globalAlpha = 1
    const done = 0.12 + 0.88 * p
    ctx.fillStyle = 'rgba(0, 0, 0, 0.86)'
    ctx.fillRect(f.x, f.y + f.h * done, f.w, f.h * (1 - done))

    setFont(ctx, 12, true)
    ctx.fillStyle = 'rgba(200, 240, 210, 0.85)'
    ctx.textAlign = 'center'
    ctx.fillText('ПРИЁМ СИГНАЛА', f.x + f.w / 2, f.y + f.h * 0.46)
    setFont(ctx, 10)
    ctx.fillText(`канал 04 · ${Math.round(p * 100)}%`, f.x + f.w / 2, f.y + f.h * 0.46 + 18)
    ctx.textAlign = 'left'

    const bar: Rect = { x: f.x + f.w * 0.25, y: f.y + f.h * 0.46 + 34, w: f.w * 0.5, h: 4 }
    fill(ctx, bar, 'rgba(120, 160, 130, 0.25)')
    fill(ctx, { ...bar, w: Math.round(bar.w * p) }, 'rgba(160, 220, 170, 0.85)')
    ctx.restore()
  }

  /** Наложение записи: зелёный тон, строки развёртки, шум и время. */
  private overlay(ctx: CanvasRenderingContext2D, f: Rect): void {
    ctx.save()
    ctx.beginPath()
    ctx.rect(f.x, f.y, f.w, f.h)
    ctx.clip()

    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = 'rgba(160, 215, 175, 0.75)'
    ctx.fillRect(f.x, f.y, f.w, f.h)
    ctx.globalCompositeOperation = 'source-over'

    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'
    for (let y = f.y; y < f.y + f.h; y += 3) ctx.fillRect(f.x, y, f.w, 1)

    ctx.globalAlpha = 0.5
    ctx.drawImage(this.noise, f.x, f.y, f.w, f.h)
    ctx.globalAlpha = 1

    // бегущая полоса помех
    const bandY = f.y + ((this.t * 60) % (f.h + 40)) - 20
    ctx.fillStyle = 'rgba(190, 220, 200, 0.07)'
    ctx.fillRect(f.x, bandY, f.w, 14)

    // виньетка
    const g = ctx.createRadialGradient(
      f.x + f.w / 2,
      f.y + f.h / 2,
      f.h * 0.25,
      f.x + f.w / 2,
      f.y + f.h / 2,
      f.h * 0.85,
    )
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.42)')
    ctx.fillStyle = g
    ctx.fillRect(f.x, f.y, f.w, f.h)

    // время и номер кадра
    const now = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    setFont(ctx, 10)
    ctx.fillStyle = 'rgba(200, 240, 210, 0.8)'
    ctx.fillText(
      `12.11.2000  ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`,
      f.x + 8,
      f.y + f.h - 10,
    )
    ctx.textAlign = 'right'
    ctx.fillText(`FRAME ${Math.floor(this.t * 25) % 100000}`, f.x + f.w - 8, f.y + f.h - 10)
    ctx.textAlign = 'left'
    ctx.restore()
  }

  click(x: number, y: number, _r: Rect): void {
    if (!this.ready) return
    // меню команд: клик по пункту выполняет команду, мимо — закрывает
    if (this.menuHit.length > 0) {
      const items = this.menuHit
      this.menuHit = []
      const id = this.menu?.id
      this.menu = null
      void id
      for (const it of items) {
        if (inside(it.r, x, y)) {
          this.sound.click()
          this.cctv?.command(it.id, it.action)
          return
        }
      }
      return
    }
    // клик по объекту кухни открывает меню команд (в режиме скана)
    if (this.channel === '05' && this.feedRect && this.scan) {
      const picked = this.pickAt(x, y)
      if (picked) {
        this.menu = { x, y, id: picked.id, items: this.menuFor(picked.id) }
        this.sound.click()
        return
      }
    }
    for (let i = this.hits.length - 1; i >= 0; i--) {
      if (inside(this.hits[i].r, x, y)) {
        this.hits[i].fn()
        return
      }
    }
  }

  /** Объект кухни под точкой рабочего стола. */
  private pickAt(x: number, y: number): { id: string; label: string } | null {
    const f = this.feedRect
    if (!f) return null
    const nx = ((x - f.x) / f.w) * 2 - 1
    const ny = -(((y - f.y) / f.h) * 2 - 1)
    return this.cctv?.pick(nx, ny) ?? null
  }

  /** Меню команд для объекта кухни. */
  private menuFor(id: string): Array<{ label: string; action: string }> {
    if (id === 'knife') return [{ label: 'Возьми нож', action: 'take' }]
    if (id === 'fridge') return [{ label: 'Осмотри холодильник', action: 'inspect' }]
    if (id === 'meat') {
      return [
        { label: 'Разрежь ножом', action: 'cut' },
        { label: 'Ничего', action: 'none' },
      ]
    }
    if (id === 'stove') return [{ label: 'Осмотри плиту', action: 'inspect' }]
    if (id === 'printer') return [{ label: 'Прочитай, что на нём', action: 'read' }]
    if (id === 'exit') return [{ label: 'Подойди к двери', action: 'try' }]
    return []
  }

  /**
   * Слой кухни поверх кадра: субтитры её реплик, режим скана с рамками и
   * подписями, меню команд и глитч, когда в кадре происходит худшее.
   */
  private kitchenUi(ctx: CanvasRenderingContext2D, f: Rect, cctv: Cctv): void {
    const now = performance.now()

    // глитч нападения: рваные полосы самого кадра и красный отсвет
    if (cctv.attackNow >= 0) {
      for (let i = 0; i < 7; i++) {
        const sy = f.y + Math.random() * f.h
        const sh = 6 + Math.random() * 30
        const srcY = (Math.random() * FEED_H) | 0
        const srcH = Math.max(2, Math.round((sh / f.h) * FEED_H))
        const dx = (Math.random() - 0.5) * 34
        ctx.drawImage(cctv.canvas, 0, srcY, FEED_W, srcH, f.x + dx, sy, f.w, sh)
      }
      ctx.fillStyle = `rgba(120, 14, 8, ${(0.12 + Math.random() * 0.2).toFixed(3)})`
      ctx.fillRect(f.x, f.y, f.w, f.h)
    }

    this.menuHit = []

    // субтитры: то, что она говорит оператору
    const sub = cctv.subtitleNow
    if (sub.text && now < sub.until) {
      const lines = wrap(ctx, sub.text, f.w - 40, 11).slice(0, 3)
      const h = lines.length * 15 + 10
      ctx.fillStyle = 'rgba(6, 10, 8, 0.72)'
      ctx.fillRect(f.x + 8, f.y + f.h - 14 - h, f.w - 16, h)
      setFont(ctx, 11)
      ctx.fillStyle = '#d8e6d8'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let y = f.y + f.h - 14 - h + 12
      for (const line of lines) {
        ctx.fillText(line, f.x + f.w / 2, y)
        y += 15
      }
      ctx.textAlign = 'left'
    }

    // подсказка про скан висит на кухне всегда, меняется по состоянию
    text(
      ctx,
      this.scan ? 'клик по объекту — команда · TAB — выключить скан' : 'TAB — подсветить объекты и команды',
      f.x + f.w / 2,
      f.y + 12,
      {
        size: 9,
        color: this.scan ? 'rgba(140, 220, 255, 0.85)' : 'rgba(200, 214, 200, 0.55)',
        align: 'center',
      },
    )

    // скан: скобки-уголки вокруг объектов и подписи
    if (this.scan && !this.menu) {
      for (const id of ['knife', 'fridge', 'meat', 'stove', 'printer', 'exit']) {
        const p = cctv.project(id)
        if (!p) continue
        const sx = f.x + (p.x / FEED_W) * f.w
        const sy = f.y + (p.y / FEED_H) * f.h
        const r = 14
        ctx.strokeStyle = 'rgba(140, 220, 255, 0.85)'
        ctx.lineWidth = 1.4
        for (const [ax, ay] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          ctx.beginPath()
          ctx.moveTo(sx + ax * r, sy + ay * r - ay * 6)
          ctx.lineTo(sx + ax * r, sy + ay * r)
          ctx.lineTo(sx + ax * r - ax * 6, sy + ay * r)
          ctx.stroke()
        }
        ctx.lineWidth = 1
        setFont(ctx, 9, true)
        ctx.fillStyle = 'rgba(140, 220, 255, 0.95)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(p.label, sx, sy - r - 8)
        ctx.textAlign = 'left'
      }
    }

    // меню команд
    if (this.menu) {
      const items = this.menu.items
      const w = 180
      const h = items.length * 22 + 8
      let mx = this.menu.x
      let my = this.menu.y
      if (mx + w > f.x + f.w - 6) mx = f.x + f.w - 6 - w
      if (my + h > f.y + f.h - 6) my = f.y + f.h - 6 - h
      panel(ctx, { x: mx, y: my, w, h }, true, 2)
      let yy = my + 4
      for (const it of items) {
        const r: Rect = { x: mx + 4, y: yy, w: w - 8, h: 18 }
        fill(ctx, r, '#dcdcd4')
        text(ctx, it.label, r.x + 8, r.y + r.h / 2, { size: 11 })
        this.menuHit.push({ r, id: this.menu.id, action: it.action, label: it.label })
        yy += 22
      }
    }
  }
}
