import { C, fill, panel, text, wrap } from '../draw'
import type { Rect } from '../draw'
import type { App } from '../app'

/** Заглушка: окно с парой строк текста. Для «Моего компьютера» и прочих пустых мест. */
export class Note implements App {
  title: string
  private lines: string[]

  constructor(title: string, lines: string[]) {
    this.title = title
    this.lines = lines
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.face)
    panel(ctx, { x: r.x + 8, y: r.y + 8, w: r.w - 16, h: r.h - 16 })
    let y = r.y + 28
    for (const line of this.lines) {
      for (const part of wrap(ctx, line, r.w - 48, 12)) {
        text(ctx, part, r.x + 24, y, { size: 12 })
        y += 17
      }
    }
  }

  click(_x: number, _y: number, _r: Rect): void {}
}
