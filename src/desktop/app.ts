import type { Rect } from './draw'

/** Приложение внутри окна: рисует себя и получает клики по своим координатам. */
export interface App {
  title: string
  draw(ctx: CanvasRenderingContext2D, r: Rect): void
  /** x, y — абсолютные координаты в системе рабочего стола. */
  click(x: number, y: number, r: Rect): void
}
