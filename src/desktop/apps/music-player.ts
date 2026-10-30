/**
 * Проигрыватель пасхалки «песенка для малыша»: открывается мгновенно по
 * клику на файл в «Музыке». Пока файл качается и декодируется — рисует
 * индикатор загрузки, чтобы было видно, что аудио грузится, а не зависло.
 * Кнопка play/pause, полоса позиции, живые столбики эквалайзера.
 * Песенка играет один раз, без зацикливания.
 */
import { C, fill, inside, panel, text } from '../draw'
import type { Rect } from '../draw'
import type { App } from '../app'
import type { Sound } from '../../audio'

type Hit = { r: Rect; fn: () => void }

export class MusicPlayer implements App {
  title = 'Песенка для малыша — Проигрыватель'
  private sound: Sound
  private hits: Hit[] = []
  private t = 0
  /** Автостарт: песенка заводится сама, как только файл докачался. */
  private autoStarted = false

  constructor(sound: Sound) {
    this.sound = sound
    // грузим файл сразу: окно открылось — загрузка уже идёт
    this.sound.prefetchSong()
  }

  /** Плеер живой: статус грузится/играет/ползёт — перерисовываем всегда. */
  tick(): boolean {
    this.t += 0.016
    const st = this.sound.songStatus
    if (!this.autoStarted && !st.loading && st.duration > 0) {
      this.autoStarted = true
      this.sound.resumeSong()
    }
    return true
  }

  click(x: number, y: number, _r: Rect): void {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      if (inside(this.hits[i].r, x, y)) {
        this.hits[i].fn()
        return
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    this.hits = []
    fill(ctx, r, C.face)

    const st = this.sound.songStatus
    const cx = r.x + r.w / 2

    // шапка плеера
    const head: Rect = { x: r.x + 6, y: r.y + 6, w: r.w - 12, h: 30 }
    panel(ctx, head, false, 1)
    fill(ctx, { x: head.x + 2, y: head.y + 2, w: head.w - 4, h: head.h - 4 }, '#101418')
    this.note(ctx, head.x + 22, head.y + head.h / 2, st.playing)
    text(ctx, 'ПЕСЕНКА ДЛЯ МАЛЫША', head.x + head.w / 2 + 12, head.y + head.h / 2, {
      size: 11,
      bold: true,
      color: '#cdd8c8',
      align: 'center',
    })

    // эквалайзер: столбики пляшут, пока играет
    const eq: Rect = { x: r.x + 24, y: r.y + 48, w: r.w - 48, h: 46 }
    panel(ctx, eq, false, 1)
    fill(ctx, { x: eq.x + 2, y: eq.y + 2, w: eq.w - 4, h: eq.h - 4 }, '#0a0e10')
    const bars = 14
    const bw = Math.floor((eq.w - 12) / bars - 3)
    for (let i = 0; i < bars; i++) {
      let h: number
      if (st.playing) {
        const wobble =
          Math.sin(this.t * (3 + i * 0.7) + i) * 0.5 + Math.sin(this.t * 7.3 + i * 2.1) * 0.5
        h = (0.25 + 0.7 * Math.abs(wobble)) * (eq.h - 10)
      } else {
        h = 4
      }
      const bx = eq.x + 8 + i * (bw + 3)
      fill(
        ctx,
        { x: bx, y: eq.y + eq.h - 5 - h, w: bw, h: Math.max(3, h) },
        st.playing ? '#4f8f57' : '#3a3f3c',
      )
    }

    // полоса позиции
    const track: Rect = { x: r.x + 24, y: r.y + 104, w: r.w - 48, h: 14 }
    panel(ctx, track, false, 1)
    fill(ctx, { x: track.x + 2, y: track.y + 2, w: track.w - 4, h: track.h - 4 }, '#8e8e86')
    if (st.duration > 0) {
      const w = Math.round((track.w - 4) * Math.min(1, st.position / st.duration))
      fill(ctx, { x: track.x + 2, y: track.y + 2, w, h: track.h - 4 }, '#2c4f86')
    }

    // кнопка play/pause
    const btn: Rect = { x: cx - 26, y: r.y + 130, w: 52, h: 26 }
    panel(ctx, btn, true, 2)
    const cy = btn.y + btn.h / 2
    if (st.playing) {
      // пауза: две палочки
      ctx.fillStyle = C.text
      ctx.fillRect(cx - 8, cy - 7, 5, 14)
      ctx.fillRect(cx + 3, cy - 7, 5, 14)
    } else {
      // play: треугольник
      ctx.fillStyle = C.text
      ctx.beginPath()
      ctx.moveTo(cx - 7, cy - 8)
      ctx.lineTo(cx + 9, cy)
      ctx.lineTo(cx - 7, cy + 8)
      ctx.closePath()
      ctx.fill()
    }
    this.hits.push({
      r: btn,
      fn: () => {
        if (this.sound.songStatus.playing) this.sound.pauseSong()
        else this.sound.resumeSong()
        this.sound.click()
      },
    })

    // статус: грузится (с бегущими точками), играет, пауза, конец
    let status = 'готов'
    let color: string = C.textDim
    if (st.loading) {
      const dots = '.'.repeat(1 + (Math.floor(this.t * 2) % 3))
      status = `загрузка аудио${dots} не зависло — качается с узла`
      color = '#8a6d1a'
    } else if (st.playing) {
      status = 'играет · один раз, без повтора'
      color = '#2c5a2c'
    } else if (st.paused && st.position > 0.2) {
      status = 'пауза'
      color = '#5c5c54'
    } else if (st.duration > 0 && st.position >= st.duration - 0.2) {
      status = 'песенка закончилась'
      color = C.textDim
    }
    text(ctx, status, cx, r.y + 172, { size: 10, color, align: 'center' })

    // время
    const fmt = (v: number): string => {
      const m = Math.floor(v / 60)
      const s = Math.floor(v % 60)
      return `${m}:${String(s).padStart(2, '0')}`
    }
    text(
      ctx,
      `${fmt(st.position)} / ${st.duration ? fmt(st.duration) : '--:--'}`,
      cx,
      r.y + 190,
      { size: 10, color: C.textDim, align: 'center' },
    )
  }

  /** Нотка в шапке: качается в такт, когда играет. */
  private note(ctx: CanvasRenderingContext2D, cx: number, cy: number, live: boolean): void {
    const sway = live ? Math.sin(this.t * 5) * 2 : 0
    ctx.save()
    ctx.translate(cx + sway, cy)
    ctx.fillStyle = live ? '#8fd08f' : '#6a6f66'
    ctx.beginPath()
    ctx.ellipse(-4, 4, 4, 3, -0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(0, -9, 2, 13)
    ctx.fillRect(0, -9, 8, 3)
    ctx.restore()
  }
}
