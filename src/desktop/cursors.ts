/**
 * Курсоры ресайза в духе Windows 2000: белая двойная стрелка с чёрным
 * контуром. Никаких готовых ассетов — маска строится геометрией и рисуется
 * в канву 32×32, наружу отдаётся data-URL для CSS cursor с hotspot в центре.
 */

export type ResizeKind = 'ew' | 'ns' | 'nwse' | 'nesw'

const S = 32
const cache = new Map<ResizeKind, string>()

/** Принадлежит ли пиксель телу стрелки (без контура). */
function solid(kind: ResizeKind, x: number, y: number): boolean {
  if (kind === 'nesw') return solid('nwse', S - 1 - x, y)
  if (kind === 'ns') return solid('ew', y, x)
  if (kind === 'nwse') {
    // диагональ из левого верхнего в правый нижний угол
    const v = x + y
    const p = Math.abs(x - y)
    const head = Math.min((v - 4) * 0.42, (58 - v) * 0.42)
    return p <= 1 ? v >= 4 && v <= 58 : p <= head && (v - 4 <= 11 || 58 - v <= 11)
  }
  // ew: головки слева и справа, между ними стержень 3 пикселя
  const dy = Math.abs(y - 16)
  return (
    (x <= 9 && dy <= Math.round((x * 6) / 9)) ||
    (x >= 9 && x <= 22 && dy <= 1) ||
    (x >= 22 && dy <= Math.round(((31 - x) * 6) / 9))
  )
}

/** Растровая маска: тело и его чёрная окантовка. */
function mask(kind: ResizeKind): Array<Array<'none' | 'white' | 'black'>> {
  const body: boolean[][] = Array.from({ length: S }, (_, y) =>
    Array.from({ length: S }, (_, x) => solid(kind, x, y)),
  )
  const m: Array<Array<'none' | 'white' | 'black'>> = Array.from({ length: S }, (_, y) =>
    Array.from({ length: S }, (_, x) => {
      if (!body[y][x]) return 'none'
      const edge =
        x === 0 ||
        y === 0 ||
        x === S - 1 ||
        y === S - 1 ||
        !body[y][x - 1] ||
        !body[y][x + 1] ||
        !body[y - 1][x] ||
        !body[y + 1][x]
      return edge ? 'black' : 'white'
    }),
  )
  return m
}

/** Data-URL курсора вида «двойная стрелка» с hotspot в центре. */
export function resizeCursorCss(kind: ResizeKind): string {
  const hit = cache.get(kind)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  const m = mask(kind)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = m[y][x]
      if (v === 'none') continue
      ctx.fillStyle = v === 'black' ? '#000000' : '#ffffff'
      ctx.fillRect(x, y, 1, 1)
    }
  }
  const half = S / 2
  const css = `url("${c.toDataURL('image/png')}") ${half} ${half}, ew-resize`
  cache.set(kind, css)
  return css
}
