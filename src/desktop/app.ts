import type { Rect } from './draw'

/** Приложение внутри окна: рисует себя и получает клики по своим координатам. */
export interface App {
  title: string
  draw(ctx: CanvasRenderingContext2D, r: Rect): void
  /** x, y — абсолютные координаты в системе рабочего стола. */
  click(x: number, y: number, r: Rect): void
  /** Кадр анимации. true — содержимое изменилось и окно надо перерисовать. */
  tick?(): boolean
  /** Клавиша активному окну. true — событие обработано. */
  key?(e: KeyboardEvent): boolean
  /** Вставка из буфера обмена. true — обработано. */
  paste?(text: string): boolean
  /** Протяжка мышью внутри содержимого окна (выделение текста в блокноте). */
  drag?(x: number, y: number, r: Rect): void
  /** Кнопка мыши отпущена — завершить протяжку. */
  release?(): void
}
