/**
 * Экран камеры 04 внутри терминала TDS.
 *
 * Картинка не появляется мгновенно: сначала сверху вниз проявляется мутный
 * кадр, потом он очищается — как медленный поток по узкому каналу. Кнопки
 * замка оживают только после полной загрузки. Сцену камеры двигает TDS,
 * сам экран её не обновляет.
 */
import { fill, inside, panel, setFont, text } from '../draw'
import type { Rect } from '../draw'
import type { Sound } from '../../audio'
import { getCctv } from '../../cctv'
import type { Cctv } from '../../cctv'

type Phase = 'locked' | 'ready' | 'untied' | 'open'
type Hit = { r: Rect; fn: () => void }

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
  private noise: HTMLCanvasElement

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

    // Отладка: ?girl — девушку отвязывают сразу, ?door — сразу открывают дверь.
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
    }

    if (this.phase === 'open') {
      this.released += 0.016
      // исчезает не на пороге, а когда уйдёт в глубь коридора и растворится
      // в темноте; 9 с — страховка, если она почему-то застряла
      const pos = cctv.girlPos
      if ((pos !== null && pos.z < -6.9) || this.released > 9) cctv.setState('gone')
    }

    // дыхание девушки: слышно, пока виден кадр, и чем больше стресс, тем чаще
    const audible = active && this.ready && this.phase !== 'open' && cctv.loaded && !cctv.gone
    this.sound.setBreathing(audible ? cctv.stress : null)
    return true
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

    // ── шапка записи ────────────────────────────────────────────────
    setFont(ctx, 11, true)
    ctx.fillStyle = '#8fd08f'
    ctx.textBaseline = 'middle'
    ctx.fillText('CAM 04', head.x + 2, head.y + head.h / 2)
    ctx.fillStyle = '#c9ccc6'
    ctx.fillText('· КОМНАТА 4, БЛОК C', head.x + 62, head.y + head.h / 2)

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
    for (let i = this.hits.length - 1; i >= 0; i--) {
      if (inside(this.hits[i].r, x, y)) {
        this.hits[i].fn()
        return
      }
    }
  }
}
