/**
 * «Блокнот» — простой текстовый редактор в духе Windows 2000.
 *
 * Умеет то, что нужно по ТЗ: печатать, выделять мышью и Shift+стрелками,
 * копировать, вырезать и вставлять. Буфер обмена — системный, через
 * `navigator.clipboard`, с запасным путём через скрытую textarea.
 */
import { C, bevel, fill, inside, panel, setFont, text } from '../draw'
import type { Rect } from '../draw'
import type { App } from '../app'
import { readClipboard, writeClipboard } from '../clipboard'

const LINE_H = 16
const PAD_X = 8
const PAD_Y = 6
const FONT = '13px "Courier New", "Lucida Console", monospace'

type Hit = { r: Rect; fn: () => void }

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export class Notepad implements App {
  title: string
  private text: string
  private caret = 0
  private anchor = 0
  private scroll = 0
  private dragging = false
  private hits: Hit[] = []
  private textRect: Rect | null = null
  /** Белое поле целиком: с него тоже можно начинать выделение. */
  private areaRect: Rect | null = null
  private charW = 8
  private status = ''

  constructor(fileName = '', text = '') {
    this.text = text
    this.title = fileName ? `${fileName} — Блокнот` : 'Блокнот'
    this.caret = this.text.length
    this.anchor = this.caret
  }

  /** Заменить содержимое открытого блокнота (файл из проводника, URL двери). */
  setContent(fileName: string, text: string): void {
    this.text = text
    this.title = fileName ? `${fileName} — Блокнот` : 'Блокнот'
    this.caret = this.text.length
    this.anchor = this.caret
    this.scroll = 0
    this.status = ''
  }

  // ── выделение и позиции ──────────────────────────────────────────

  private get selStart(): number {
    return Math.min(this.caret, this.anchor)
  }

  private get selEnd(): number {
    return Math.max(this.caret, this.anchor)
  }

  private get hasSelection(): boolean {
    return this.selStart !== this.selEnd
  }

  private get lines(): string[] {
    return this.text.split('\n')
  }

  private lineStarts(): number[] {
    const out = [0]
    for (let i = 0; i < this.text.length; i++) {
      if (this.text[i] === '\n') out.push(i + 1)
    }
    return out
  }

  private lineCol(index: number): { line: number; col: number } {
    const starts = this.lineStarts()
    let line = 0
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= index) line = i
      else break
    }
    return { line, col: index - starts[line] }
  }

  private posFromLineCol(line: number, col: number): number {
    const starts = this.lineStarts()
    const l = clamp(line, 0, starts.length - 1)
    const len = (l + 1 < starts.length ? starts[l + 1] - 1 : this.text.length) - starts[l]
    return starts[l] + clamp(col, 0, len)
  }

  private moveTo(pos: number, extend: boolean): void {
    const p = clamp(pos, 0, this.text.length)
    this.caret = p
    if (!extend) this.anchor = p
    this.ensureVisible()
  }

  private ensureVisible(): void {
    const visible = Math.max(1, Math.floor(((this.textRect?.h ?? 300) - 2) / LINE_H))
    const { line } = this.lineCol(this.caret)
    if (line < this.scroll) this.scroll = line
    else if (line >= this.scroll + visible) this.scroll = line - visible + 1
  }

  private posAt(x: number, y: number): number {
    const tr = this.textRect
    if (!tr) return this.caret
    const count = this.lines.length
    const line = clamp(Math.floor((y - tr.y) / LINE_H) + this.scroll, 0, count - 1)
    const rawCol = Math.round((x - tr.x) / this.charW)
    const starts = this.lineStarts()
    const len =
      (line + 1 < starts.length ? starts[line + 1] - 1 : this.text.length) - starts[line]
    return this.posFromLineCol(line, clamp(rawCol, 0, len))
  }

  private replaceSelection(insert: string): void {
    const s = this.selStart
    const e = this.selEnd
    this.text = this.text.slice(0, s) + insert + this.text.slice(e)
    this.caret = s + insert.length
    this.anchor = this.caret
    this.status = ''
    this.ensureVisible()
  }

  private deleteBack(): void {
    if (this.hasSelection) {
      this.replaceSelection('')
      return
    }
    if (this.caret <= 0) return
    this.text = this.text.slice(0, this.caret - 1) + this.text.slice(this.caret)
    this.caret--
    this.anchor = this.caret
    this.status = ''
    this.ensureVisible()
  }

  private deleteForward(): void {
    if (this.hasSelection) {
      this.replaceSelection('')
      return
    }
    if (this.caret >= this.text.length) return
    this.text = this.text.slice(0, this.caret) + this.text.slice(this.caret + 1)
    this.anchor = this.caret
    this.status = ''
    this.ensureVisible()
  }

  // ── буфер обмена ─────────────────────────────────────────────────

  private copy(): boolean {
    if (!this.hasSelection) {
      this.status = 'нечего копировать'
      return false
    }
    const value = this.text.slice(this.selStart, this.selEnd)
    if (!writeClipboard(value)) {
      this.status = 'браузер не дал доступ к буферу'
      return false
    }
    this.status = `скопировано: ${value.length} симв.`
    return true
  }

  private cut(): boolean {
    if (!this.hasSelection) {
      this.status = 'нечего вырезать'
      return false
    }
    const n = this.selEnd - this.selStart
    if (!writeClipboard(this.text.slice(this.selStart, this.selEnd))) {
      this.status = 'браузер не дал доступ к буферу'
      return false
    }
    this.replaceSelection('')
    this.status = `вырезано: ${n} симв.`
    return true
  }

  private async pasteFromButton(): Promise<void> {
    const value = await readClipboard()
    if (value === null) {
      this.status = 'нет доступа к буферу — нажмите Ctrl+V'
      return
    }
    this.insert(value)
  }

  private insert(value: string): void {
    if (!value) return
    this.replaceSelection(value.replace(/\r\n?/g, '\n'))
  }

  // ── клавиатура ───────────────────────────────────────────────────

  key(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    const shift = e.shiftKey

    if (mod) {
      const low = k.toLowerCase()
      if (low === 'a') {
        this.anchor = 0
        this.caret = this.text.length
        this.scroll = 0
        return true
      }
      if (low === 'c') {
        this.copy()
        return true
      }
      if (low === 'x') {
        this.cut()
        return true
      }
      // Ctrl+V приходит отдельным событием paste
      if (low === 'v') return true
      if (k === 'Home') {
        this.moveTo(0, shift)
        return true
      }
      if (k === 'End') {
        this.moveTo(this.text.length, shift)
        return true
      }
      return false
    }

    if (k === 'ArrowLeft') {
      this.moveTo(this.hasSelection && !shift ? this.selStart : this.caret - 1, shift)
      return true
    }
    if (k === 'ArrowRight') {
      this.moveTo(this.hasSelection && !shift ? this.selEnd : this.caret + 1, shift)
      return true
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      const { line, col } = this.lineCol(this.caret)
      this.moveTo(this.posFromLineCol(line + (k === 'ArrowUp' ? -1 : 1), col), shift)
      return true
    }
    if (k === 'Home' || k === 'End') {
      const { line } = this.lineCol(this.caret)
      if (k === 'Home') this.moveTo(this.posFromLineCol(line, 0), shift)
      else {
        const starts = this.lineStarts()
        const end = line + 1 < starts.length ? starts[line + 1] - 1 : this.text.length
        this.moveTo(end, shift)
      }
      return true
    }
    if (k === 'PageUp' || k === 'PageDown') {
      const visible = Math.max(1, Math.floor(((this.textRect?.h ?? 300) - 2) / LINE_H))
      const { line, col } = this.lineCol(this.caret)
      this.moveTo(this.posFromLineCol(line + (k === 'PageUp' ? -visible : visible), col), shift)
      return true
    }
    if (k === 'Backspace') {
      this.deleteBack()
      return true
    }
    if (k === 'Delete') {
      this.deleteForward()
      return true
    }
    if (k === 'Enter') {
      this.replaceSelection('\n')
      return true
    }
    if (k === 'Tab') {
      this.replaceSelection('  ')
      return true
    }
    if (e.altKey) return false
    if (k.length !== 1) return false

    this.replaceSelection(k)
    return true
  }

  paste(value: string): boolean {
    if (!value) return false
    this.insert(value)
    this.status = 'вставлено из буфера'
    return true
  }

  // ── мышь ─────────────────────────────────────────────────────────

  click(x: number, y: number, _r: Rect): void {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      if (inside(this.hits[i].r, x, y)) {
        this.hits[i].fn()
        return
      }
    }
    const field = this.areaRect ?? this.textRect
    if (field && inside(field, x, y)) {
      const pos = this.posAt(x, y)
      this.anchor = pos
      this.caret = pos
      this.dragging = true
      this.status = ''
      this.ensureVisible()
    }
  }

  drag(x: number, y: number, _r: Rect): void {
    if (!this.dragging) return
    this.caret = this.posAt(x, y)
    this.ensureVisible()
  }

  release(): void {
    this.dragging = false
  }

  // ── отрисовка ────────────────────────────────────────────────────

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    this.hits = []
    fill(ctx, r, C.face)
    this.toolbar(ctx, { x: r.x, y: r.y, w: r.w, h: 26 })

    const area: Rect = { x: r.x + 2, y: r.y + 26, w: r.w - 4, h: r.h - 26 - 18 }
    this.areaRect = area
    fill(ctx, area, '#ffffff')
    bevel(ctx, area, false, 1)

    const tr: Rect = {
      x: area.x + PAD_X,
      y: area.y + PAD_Y,
      w: area.w - PAD_X * 2 - 12,
      h: area.h - PAD_Y * 2,
    }
    this.textRect = tr

    ctx.save()
    ctx.beginPath()
    ctx.rect(tr.x - 2, tr.y - 2, tr.w + 4, tr.h + 4)
    ctx.clip()
    ctx.font = FONT
    this.charW = ctx.measureText('M').width
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    const lines = this.lines
    const starts = this.lineStarts()
    const visible = Math.max(1, Math.floor((tr.h - 2) / LINE_H))
    const first = clamp(this.scroll, 0, Math.max(0, lines.length - 1))
    const last = Math.min(lines.length, first + visible + 1)
    const selS = this.selStart
    const selE = this.selEnd

    for (let i = first; i < last; i++) {
      const line = lines[i]
      const baseY = tr.y + (i - first) * LINE_H + LINE_H / 2
      const lineStart = starts[i]
      const from = Math.max(selS, lineStart) - lineStart
      const to = Math.min(selE, lineStart + line.length) - lineStart

      if (selE > selS && to > from) {
        const x1 = tr.x + ctx.measureText(line.slice(0, from)).width
        const x2 = tr.x + ctx.measureText(line.slice(0, to)).width
        ctx.fillStyle = C.select
        ctx.fillRect(x1, baseY - LINE_H / 2 + 1, Math.max(1, x2 - x1), LINE_H - 2)
      }

      ctx.fillStyle = C.ink
      ctx.fillText(line, tr.x, baseY)
      if (selE > selS && to > from) {
        const x1 = tr.x + ctx.measureText(line.slice(0, from)).width
        ctx.fillStyle = '#ffffff'
        ctx.fillText(line.slice(from, to), x1, baseY)
      }
    }

    // каретка
    const caretLine = this.lineCol(this.caret)
    if (caretLine.line >= first && caretLine.line < first + visible) {
      const line = lines[caretLine.line] ?? ''
      const cx = tr.x + ctx.measureText(line.slice(0, caretLine.col)).width
      const cy = tr.y + (caretLine.line - first) * LINE_H
      ctx.fillStyle = '#111111'
      ctx.fillRect(cx, cy + 2, 1, LINE_H - 4)
    }
    ctx.restore()

    this.scrollbar(ctx, area, lines.length, visible)
    this.statusBar(ctx, { x: r.x, y: r.y + r.h - 18, w: r.w, h: 18 })
  }

  private toolbar(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.face)
    const has = this.hasSelection
    const items: Array<[string, boolean, () => void]> = [
      ['Копировать', has, () => this.copy()],
      ['Вырезать', has, () => this.cut()],
      ['Вставить', true, () => void this.pasteFromButton()],
      [
        'Выделить всё',
        true,
        () => {
          this.anchor = 0
          this.caret = this.text.length
          this.scroll = 0
        },
      ],
    ]

    let x = r.x + 4
    for (const [label, enabled, fn] of items) {
      setFont(ctx, 11)
      const w = Math.ceil(ctx.measureText(label).width) + 16
      const btn: Rect = { x, y: r.y + 3, w, h: r.h - 6 }
      panel(ctx, btn, enabled, 1)
      text(ctx, label, btn.x + btn.w / 2, btn.y + btn.h / 2, {
        size: 11,
        color: enabled ? C.text : C.textDim,
        align: 'center',
      })
      if (enabled) this.hits.push({ r: btn, fn })
      x += w + 4
    }
  }

  private scrollbar(
    ctx: CanvasRenderingContext2D,
    area: Rect,
    total: number,
    visible: number,
  ): void {
    if (total <= visible) return
    const track: Rect = { x: area.x + area.w - 12, y: area.y + 2, w: 10, h: area.h - 4 }
    fill(ctx, track, '#d6d4c8')
    bevel(ctx, track, false, 1)
    const h = Math.max(16, Math.round((track.h * visible) / total))
    const y = track.y + Math.round(((track.h - h) * this.scroll) / Math.max(1, total - visible))
    panel(ctx, { x: track.x + 1, y, w: track.w - 2, h }, true, 1)
  }

  private statusBar(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.face)
    bevel(ctx, r, false, 1)
    const { line, col } = this.lineCol(this.caret)
    text(ctx, `Стр ${line + 1}, Стл ${col + 1}`, r.x + 8, r.y + r.h / 2, {
      size: 10,
      color: C.textDim,
    })
    const right = this.hasSelection
      ? `выделено ${this.selEnd - this.selStart} симв.`
      : this.status
    if (right) {
      text(ctx, right, r.x + r.w - 8, r.y + r.h / 2, {
        size: 10,
        color: C.textDim,
        align: 'right',
      })
    }
  }
}
