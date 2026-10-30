/**
 * «Мой компьютер» — проводник в стиле Windows 2000.
 *
 * Папки: Загрузки, Документы, Музыка, Изображения, Видео. Файлы выдаёт
 * рабочий стол: по ходу игры появляются tds.exe в Загрузках, дверь.txt
 * с адресом панели сброса в Загрузках и Документах, пасхалка в Изображениях.
 */
import { C, bevel, fill, inside, panel, text } from '../draw'
import type { Rect } from '../draw'
import type { App } from '../app'
import type { Sound } from '../../audio'
import { drawIcon } from '../icons'

export type DeskFile = {
  folder: string
  name: string
  kind: 'txt' | 'exe' | 'image' | 'audio'
}

type Node = { name: string; kind: 'folder' | 'txt' | 'exe' | 'image' | 'audio'; file?: DeskFile }

const FOLDERS = ['Загрузки', 'Документы', 'Музыка', 'Изображения', 'Видео']

const GLYPH: Record<Node['kind'], string> = {
  folder: 'folder',
  txt: 'file',
  exe: 'virus',
  image: 'image',
  audio: 'music',
}

type Hit = { r: Rect; fn: () => void }

export class Explorer implements App {
  title = 'Мой компьютер'
  private path: string[] = []
  private hits: Hit[] = []
  private sound: Sound
  /** Файлы решает рабочий стол: он знает, что уже «скачано» и «сохранено». */
  private files: () => DeskFile[]
  private openFile: (file: DeskFile) => void

  constructor(sound: Sound, files: () => DeskFile[], openFile: (file: DeskFile) => void) {
    this.sound = sound
    this.files = files
    this.openFile = openFile
  }

  private get items(): Node[] {
    if (this.path.length === 0) {
      return FOLDERS.map((name) => ({ name, kind: 'folder' as const }))
    }
    const folder = this.path[this.path.length - 1]
    return this.files()
      .filter((f) => f.folder === folder)
      .map((f) => ({ name: f.name, kind: f.kind, file: f }))
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    this.hits = []
    fill(ctx, r, C.face)

    this.toolbar(ctx, { x: r.x, y: r.y, w: r.w, h: 26 })
    this.addressBar(ctx, { x: r.x, y: r.y + 26, w: r.w, h: 22 })

    const list: Rect = { x: r.x, y: r.y + 48, w: r.w, h: r.h - 48 - 18 }
    this.drawList(ctx, list)

    const status: Rect = { x: r.x, y: r.y + r.h - 18, w: r.w, h: 18 }
    fill(ctx, status, C.face)
    bevel(ctx, status, false, 1)
    const count = this.items.length
    // играет пасхалка или нет — видно прямо в статусе
    const right = this.sound.songPlaying ? '♪ играет: песенка для малыша.ogg' : ''
    if (right) {
      text(ctx, right, status.x + status.w - 8, status.y + status.h / 2, {
        size: 10,
        color: C.textDim,
        align: 'right',
      })
    }
    text(
      ctx,
      this.path.length ? (count ? `Объектов: ${count}` : 'Папка пуста') : `Объектов: ${count}`,
      status.x + 8,
      status.y + status.h / 2,
      { size: 10, color: C.textDim },
    )
  }

  private toolbar(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.face)
    const y = r.y + 3
    const h = r.h - 6

    const back: Rect = { x: r.x + 4, y, w: 62, h }
    const up: Rect = { x: back.x + 66, y, w: 46, h }
    const view: Rect = { x: up.x + 50, y, w: 54, h }

    this.toolButton(ctx, back, 'Назад', this.path.length > 0, () => this.back())
    this.toolButton(ctx, up, 'Вверх', this.path.length > 0, () => this.back())
    this.toolButton(ctx, view, 'Вид', true, () => this.sound.click())
  }

  private toolButton(
    ctx: CanvasRenderingContext2D,
    b: Rect,
    label: string,
    enabled: boolean,
    fn: () => void,
  ): void {
    panel(ctx, b, true, 1)
    text(ctx, label, b.x + b.w / 2, b.y + b.h / 2, {
      size: 10,
      align: 'center',
      color: enabled ? C.text : C.textDim,
    })
    if (enabled) this.hits.push({ r: b, fn })
  }

  private addressBar(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.face)
    text(ctx, 'Адрес:', r.x + 6, r.y + r.h / 2, { size: 10, color: C.textDim })

    const field: Rect = { x: r.x + 44, y: r.y + 3, w: r.w - 50, h: r.h - 6 }
    fill(ctx, field, '#ffffff')
    ctx.strokeStyle = C.lo
    ctx.strokeRect(field.x + 0.5, field.y + 0.5, field.w - 1, field.h - 1)

    const path = ['Мой компьютер', ...this.path].join('\\')
    text(ctx, path, field.x + 4, field.y + field.h / 2, { size: 11, color: C.ink })
  }

  private drawList(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, '#ffffff')
    ctx.strokeStyle = C.lo
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)

    const items = this.items
    if (items.length === 0) {
      const cx = r.x + r.w / 2
      text(ctx, 'Эта папка пуста.', cx, r.y + r.h / 2 - 10, {
        size: 12,
        color: C.textDim,
        align: 'center',
      })
      return
    }

    const cw = 96
    const ch = 84
    const cols = Math.max(1, Math.floor((r.w - 16) / cw))
    items.forEach((node, i) => {
      const x = r.x + 10 + (i % cols) * cw
      const y = r.y + 10 + Math.floor(i / cols) * ch
      drawIcon(ctx, GLYPH[node.kind], x + 24, y + 24, 1.5)
      text(ctx, node.name, x + 24, y + 58, { size: 11, color: C.ink, align: 'center' })
      this.hits.push({
        r: { x, y, w: cw - 8, h: ch - 6 },
        fn: () => {
          if (node.kind === 'folder') {
            this.path.push(node.name)
            this.sound.open()
          } else if (node.file) {
            this.sound.click()
            this.openFile(node.file)
          }
        },
      })
    })
  }

  private back(): void {
    this.path.pop()
    this.sound.click()
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
