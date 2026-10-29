/**
 * «КАМ-04» — окно камеры наблюдения.
 *
 * Показывает запись с камеры в комнате, где заперта девушка. Кнопка «открыть
 * дверь» заблокирована, пока игрок не прочитает письмо: замок управляется
 * только изнутри системы.
 */
import { bevel, fill, inside, panel, setFont, text } from '../draw'
import type { Rect } from '../draw'
import type { App } from '../app'
import type { Sound } from '../../audio'
import { Cctv } from '../../cctv'

type Phase = 'locked' | 'ready' | 'open'

type Hit = { r: Rect; fn: () => void }

export class Camera implements App {
  title = 'КАМ-04 · камера'
  private hits: Hit[] = []
  private sound: Sound
  private cctv: Cctv | null = null
  private phase: Phase = 'locked'
  private t = 0
  private released = 0
  private noise: HTMLCanvasElement

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

  tick(): boolean {
    if (!this.cctv) return false
    this.t += 0.016
    this.cctv.update()

    if (this.phase === 'open') {
      this.released += 0.016
      if (this.released > 4.5) this.cctv.setState('gone')
      return true
    }

    // девушка мечется: бродит, потом стучит в дверь
    const cycle = this.t % 12
    if (cycle < 7) this.cctv.setState('pace')
    else if (cycle < 11) this.cctv.setState('knock')
    else this.cctv.setState('idle')

    return true
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    this.hits = []
    fill(ctx, r, '#1b1d1f')

    if (!this.cctv) this.cctv = new Cctv()

    // ── рамка записи ────────────────────────────────────────────────
    const head: Rect = { x: r.x + 8, y: r.y + 6, w: r.w - 16, h: 18 }
    const footH = 78
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
    if (this.cctv.loaded) {
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(this.cctv.canvas, feed.x, feed.y, feed.w, feed.h)
      ctx.restore()
      this.overlay(ctx, feed)
    } else {
      this.noSignal(ctx, feed)
    }

    ctx.strokeStyle = '#3c4044'
    ctx.strokeRect(feed.x + 0.5, feed.y + 0.5, feed.w - 1, feed.h - 1)

    // ── шапка записи ────────────────────────────────────────────────
    setFont(ctx, 11, true)
    ctx.fillStyle = '#8fd08f'
    ctx.textBaseline = 'middle'
    ctx.fillText('CAM 04', head.x + 2, head.y + head.h / 2)
    ctx.fillStyle = '#c9ccc6'
    ctx.fillText('· КОРИДОР, БЛОК C', head.x + 62, head.y + head.h / 2)

    if (Math.floor(this.t * 2) % 2 === 0) {
      ctx.fillStyle = '#c0392b'
      ctx.beginPath()
      ctx.arc(head.x + head.w - 46, head.y + head.h / 2, 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#c9ccc6'
    ctx.fillText('ЗАПИСЬ', head.x + head.w - 38, head.y + head.h / 2)

    // ── подвал: статус и кнопка ─────────────────────────────────────
    const foot: Rect = { x: r.x + 8, y: feed.y + feed.h + 8, w: r.w - 16, h: footH - 12 }
    fill(ctx, foot, '#24272a')
    bevel(ctx, foot, false, 1)

    const status =
      this.phase === 'locked'
        ? 'ЗАМОК НЕДОСТУПЕН · НЕТ КОМАНДЫ'
        : this.phase === 'ready'
          ? 'КАНАЛ ОТКРЫТ · МОЖНО ДАТЬ КОМАНДУ'
          : 'ДВЕРЬ ОТКРЫТА · ОБЪЕКТ ПОКИДАЕТ КАМЕРУ'
    setFont(ctx, 11)
    ctx.fillStyle = this.phase === 'locked' ? '#d08a8a' : '#9fd39f'
    ctx.fillText(status, foot.x + 10, foot.y + 16)

    const hint =
      this.phase === 'locked'
        ? 'Прочитайте письмо в почте: доступ к замку выдаётся там.'
        : this.phase === 'ready'
          ? 'Девушка смотрит в камеру. Она ждёт вашего решения.'
          : 'Она вышла. Камера пишет пустой коридор.'
    setFont(ctx, 10)
    ctx.fillStyle = '#8f948d'
    ctx.fillText(hint, foot.x + 10, foot.y + 32)

    const btn: Rect = { x: foot.x + foot.w - 214, y: foot.y + 12, w: 202, h: 34 }
    const enabled = this.phase === 'ready'
    panel(ctx, btn, enabled, 2)
    setFont(ctx, 13, true)
    ctx.fillStyle = enabled ? '#1d3a1d' : '#6d6d66'
    ctx.textAlign = 'center'
    ctx.fillText(
      this.phase === 'open' ? 'ДВЕРЬ ОТКРЫТА' : enabled ? 'ОТКРЫТЬ ДВЕРЬ' : 'ЗАБЛОКИРОВАНО',
      btn.x + btn.w / 2,
      btn.y + btn.h / 2,
    )
    ctx.textAlign = 'left'

    if (enabled) {
      this.hits.push({
        r: btn,
        fn: () => {
          this.phase = 'open'
          this.released = 0
          this.cctv?.release()
          this.sound.open()
        },
      })
    }
  }

  /** Наложение записи: зелёный тон, строки развёртки, шум и время. */
  private overlay(ctx: CanvasRenderingContext2D, f: Rect): void {
    ctx.save()
    ctx.beginPath()
    ctx.rect(f.x, f.y, f.w, f.h)
    ctx.clip()

    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = 'rgba(150, 210, 170, 0.9)'
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
    g.addColorStop(1, 'rgba(0,0,0,0.55)')
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

  private noSignal(ctx: CanvasRenderingContext2D, f: Rect): void {
    text(ctx, 'НЕТ СИГНАЛА', f.x + f.w / 2, f.y + f.h / 2, {
      size: 14,
      bold: true,
      color: '#8f948d',
      align: 'center',
    })
  }

  click(x: number, y: number, _r: Rect): void {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      if (inside(this.hits[i].r, x, y)) {
        this.hits[i].fn()
        return
      }
    }
  }
}
