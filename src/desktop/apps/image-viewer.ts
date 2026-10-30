/**
 * Просмотр изображения: окно с картинкой из «Изображений».
 * Пасхалка проводника — рисунок открывается как обычный файл.
 */
import { fill, setFont } from '../draw'
import type { Rect } from '../draw'
import type { App } from '../app'

export class ImageViewer implements App {
  title: string
  private img: HTMLImageElement
  private ready = false
  private failed = false

  constructor(fileName: string) {
    this.title = `${fileName} — Просмотр`
    this.img = new Image()
    this.img.onload = () => {
      this.ready = true
    }
    this.img.onerror = () => {
      this.failed = true
    }
    this.load(fileName)
  }

  /** Открыть другой файл в том же окне (клик по картинки в проводнике). */
  show(fileName: string): void {
    this.ready = false
    this.failed = false
    this.load(fileName)
  }

  private load(fileName: string): void {
    this.title = `${fileName} — Просмотр`
    this.img.src = `images/${encodeURIComponent(fileName)}`
  }

  /** Картинка догрузилась — окно надо перерисовать. */
  tick(): boolean {
    return !this.ready && !this.failed && this.img.complete
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, '#0b0b0a')
    if (!this.ready) {
      setFont(ctx, 12)
      ctx.fillStyle = '#8f948d'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(
        this.failed ? 'ФАЙЛ ПОВРЕЖДЁН' : 'ЗАГРУЗКА…',
        r.x + r.w / 2,
        r.y + r.h / 2,
      )
      ctx.textAlign = 'left'
      return
    }
    // вписать с сохранением пропорций
    const k = Math.min((r.w - 16) / this.img.width, (r.h - 16) / this.img.height)
    const w = Math.round(this.img.width * k)
    const h = Math.round(this.img.height * k)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(this.img, Math.round(r.x + (r.w - w) / 2), Math.round(r.y + (r.h - h) / 2), w, h)
  }

  click(_x: number, _y: number, _r: Rect): void {}
}
