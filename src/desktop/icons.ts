/**
 * Иконки рабочего стола 32×32 в духе Windows 2000.
 *
 * Рисуются кодом в пиксельный буфер: фигуры, тёмный контур в один пиксель и
 * тень под значком. На экран выводятся целым увеличением без сглаживания —
 * поэтому выглядят как настоящие растровые иконки той эпохи, а не как
 * современные сглаженные картинки.
 */

const S = 32

type RGBA = readonly [number, number, number, number]

function rgba(hex: string, a = 255): RGBA {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a]
}

const INK = rgba('#141410')

class Pix {
  private d = new Uint8ClampedArray(S * S * 4)

  put(x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= S || y >= S) return
    const i = (y * S + x) * 4
    const sa = c[3] / 255
    const da = this.d[i + 3] / 255
    const oa = sa + da * (1 - sa)
    if (oa <= 0) return
    this.d[i] = (c[0] * sa + this.d[i] * da * (1 - sa)) / oa
    this.d[i + 1] = (c[1] * sa + this.d[i + 1] * da * (1 - sa)) / oa
    this.d[i + 2] = (c[2] * sa + this.d[i + 2] * da * (1 - sa)) / oa
    this.d[i + 3] = oa * 255
  }

  private alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= S || y >= S) return 0
    return this.d[(y * S + x) * 4 + 3]
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, c)
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) this.put(cx + x, cy + y, c)
      }
    }
  }

  /** Контур эллипса толщиной в пиксель (меридианы глобуса, орбита). */
  ring(cx: number, cy: number, rx: number, ry: number, c: RGBA, band = 0.16): void {
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        const v = (x * x) / (rx * rx) + (y * y) / (ry * ry)
        if (Math.abs(v - 1) <= band) this.put(cx + x, cy + y, c)
      }
    }
  }

  poly(pts: Array<[number, number]>, c: RGBA): void {
    const ys = pts.map((p) => p[1])
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = []
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        if (a[1] === b[1]) continue
        const lo = Math.min(a[1], b[1])
        const hi = Math.max(a[1], b[1])
        if (y < lo || y >= hi) continue
        xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
      }
      xs.sort((p, q) => p - q)
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) this.put(x, y, c)
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      this.put(x0, y0, c)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x0 += sx
      }
      if (e2 <= dx) {
        err += dx
        y0 += sy
      }
    }
  }

  /** Тёмный контур в один пиксель вокруг непрозрачных пикселей. */
  outline(c: RGBA): void {
    const edge: Array<[number, number]> = []
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (this.alpha(x, y) > 0) continue
        if (
          this.alpha(x - 1, y) > 0 ||
          this.alpha(x + 1, y) > 0 ||
          this.alpha(x, y - 1) > 0 ||
          this.alpha(x, y + 1) > 0
        ) {
          edge.push([x, y])
        }
      }
    }
    for (const [x, y] of edge) this.put(x, y, c)
  }

  /** Тень: сдвинутый силуэт под иконкой, только по пустым пикселям. */
  shadow(dx: number, dy: number, c: RGBA): void {
    const copy = new Uint8ClampedArray(this.d)
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (copy[(y * S + x) * 4 + 3] === 0) continue
        const tx = x + dx
        const ty = y + dy
        if (tx < 0 || ty < 0 || tx >= S || ty >= S) continue
        if (this.d[(ty * S + tx) * 4 + 3] !== 0) continue
        this.put(tx, ty, c)
      }
    }
  }

  canvas(): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = S
    c.height = S
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('canvas 2d недоступен')
    ctx.putImageData(new ImageData(this.d, S, S), 0, 0)
    return c
  }
}

// ── значки ─────────────────────────────────────────────────────────

/** Почта: конверт с торчащим письмом и маркой. */
function mail(p: Pix): void {
  const sheet = rgba('#fdfbf0')
  const sheetLo = rgba('#c9c3aa')
  const body = rgba('#f2ecd6')
  const bodyLo = rgba('#d5cfb4')
  const bodyHi = rgba('#fffdf2')
  const flap = rgba('#e9e2c8')

  // письмо из конверта
  p.rect(7, 4, 18, 9, sheet)
  p.rect(7, 4, 18, 1, rgba('#e4dfc6'))
  for (const y of [7, 9]) p.rect(9, y, 14, 1, rgba('#b9b39c'))

  // конверт
  p.rect(3, 12, 26, 13, body)
  p.rect(3, 12, 26, 1, bodyHi)
  p.rect(3, 24, 26, 1, bodyLo)
  p.rect(28, 12, 1, 13, bodyLo)

  // клапан
  p.poly(
    [
      [3, 12],
      [16, 21],
      [28, 12],
    ],
    flap,
  )
  p.line(3, 12, 16, 21, sheetLo)
  p.line(28, 12, 16, 21, sheetLo)

  // марка
  p.rect(21, 14, 5, 3, rgba('#b23a2e'))
  p.rect(21, 14, 5, 1, rgba('#d4604f'))
}

/** Интернет: глобус с меридианами и золотой орбитой. */
function globe(p: Pix): void {
  const sea = rgba('#2f6cb0')
  const seaHi = rgba('#5b93d6')
  const land = rgba('#4f9a4a')
  const landHi = rgba('#6fbb63')
  const grid = rgba('#a9cdf0')
  const orbit = rgba('#d8b24a')

  p.ellipse(16, 16, 12, 12, sea)
  p.ellipse(11, 11, 4, 3, seaHi)
  p.ellipse(10, 14, 3, 2, land)
  p.ellipse(19, 11, 4, 2, land)
  p.ellipse(21, 20, 3, 3, land)
  p.ellipse(13, 22, 3, 2, land)
  p.ellipse(10, 14, 1, 1, landHi)
  p.ellipse(19, 11, 2, 1, landHi)

  p.ring(16, 16, 5, 11, grid, 0.2)
  p.ring(16, 16, 12, 4, grid, 0.22)

  // орбита спутника
  p.ring(16, 16, 15, 5, orbit, 0.12)
  p.ellipse(29, 12, 1, 1, rgba('#f0d27a'))
}

/** Мой компьютер: монитор с подсвеченным экраном и системный блок. */
function computer(p: Pix): void {
  const caseC = rgba('#cfcbbc')
  const caseLo = rgba('#9d998a')
  const caseHi = rgba('#eae7da')
  const screen = rgba('#1f6b74')
  const screenHi = rgba('#3ea3ad')

  // системный блок
  p.rect(23, 8, 7, 17, caseC)
  p.rect(23, 8, 7, 1, caseHi)
  p.rect(29, 8, 1, 17, caseLo)
  p.rect(24, 10, 5, 2, caseLo)
  p.rect(24, 14, 5, 2, caseLo)
  p.rect(24, 20, 2, 1, rgba('#5fae5f'))

  // монитор
  p.rect(2, 9, 20, 15, caseC)
  p.rect(2, 9, 20, 1, caseHi)
  p.rect(2, 23, 20, 1, caseLo)
  p.rect(21, 9, 1, 15, caseLo)

  // экран
  p.rect(4, 11, 16, 11, screen)
  p.rect(4, 11, 16, 2, screenHi)
  p.rect(5, 13, 5, 3, rgba('#5ab8c2'))

  // подставка и клавиатура
  p.rect(10, 24, 4, 2, caseLo)
  p.rect(6, 26, 12, 2, caseC)
  p.rect(7, 28, 16, 3, rgba('#dedacb'))
  p.rect(7, 28, 16, 1, caseHi)
  for (let x = 9; x < 22; x += 3) p.rect(x, 30, 1, 1, caseLo)
}

/** Корзина: сетчатая урна с торчащими бумагами. */
function trash(p: Pix): void {
  const bin = rgba('#c9cbc2')
  const binLo = rgba('#93958b')
  const binHi = rgba('#e8eadf')
  const paper = rgba('#f8f5e8')

  // бумаги
  p.poly(
    [
      [10, 6],
      [16, 4],
      [16, 14],
      [10, 14],
    ],
    paper,
  )
  p.poly(
    [
      [16, 4],
      [22, 7],
      [22, 14],
      [16, 14],
    ],
    paper,
  )
  p.rect(12, 8, 3, 1, rgba('#a9a79a'))
  p.rect(12, 10, 3, 1, rgba('#a9a79a'))
  p.rect(18, 9, 3, 1, rgba('#a9a79a'))
  p.rect(18, 11, 3, 1, rgba('#a9a79a'))

  // корпус
  p.poly(
    [
      [7, 13],
      [25, 13],
      [22, 28],
      [10, 28],
    ],
    bin,
  )
  for (let x = 10; x < 24; x += 3) p.line(x, 15, x - 1, 27, binLo)

  // обод
  p.rect(5, 11, 22, 3, binHi)
  p.rect(5, 11, 22, 1, rgba('#ffffff'))
  p.rect(5, 13, 22, 1, binLo)
}

/** Папка: жёлтая, с язычком и тенью внутри. */
function folder(p: Pix): void {
  const back = rgba('#d8a520')
  const front = rgba('#f2c94c')
  const frontHi = rgba('#ffe38a')
  const frontLo = rgba('#c99a1e')

  p.rect(3, 9, 12, 4, back)
  p.rect(3, 11, 26, 16, back)
  p.rect(3, 12, 26, 1, frontLo)

  p.poly(
    [
      [3, 15],
      [29, 15],
      [27, 27],
      [5, 27],
    ],
    front,
  )
  p.rect(4, 15, 24, 2, frontHi)
  p.rect(5, 26, 22, 1, frontLo)
}

/** Файл: лист с загнутым углом и строчками текста. */
function file(p: Pix): void {
  const paper = rgba('#f7f5ea')
  const paperLo = rgba('#c9c5b2')
  p.poly(
    [
      [7, 3],
      [21, 3],
      [27, 9],
      [27, 29],
      [7, 29],
    ],
    paper,
  )
  p.rect(7, 3, 14, 1, rgba('#ffffff'))
  p.rect(7, 28, 20, 1, paperLo)
  p.poly(
    [
      [21, 3],
      [21, 9],
      [27, 9],
    ],
    rgba('#dedac6'),
  )
  p.line(21, 3, 21, 9, paperLo)
  p.line(21, 9, 27, 9, paperLo)
  for (const y of [14, 17, 20, 23]) p.rect(10, y, 13, 1, rgba('#8f8d80'))
}

/** Программа: окошко с камерой наблюдения. */
function camera(p: Pix): void {
  const body = rgba('#5c6672')
  const bodyHi = rgba('#8b96a3')
  const bodyLo = rgba('#39414b')
  const glass = rgba('#1d2b36')

  // кронштейн
  p.rect(15, 22, 4, 6, bodyLo)
  p.rect(9, 27, 16, 2, body)
  p.rect(9, 27, 16, 1, bodyHi)

  // корпус
  p.poly(
    [
      [6, 8],
      [22, 5],
      [26, 14],
      [10, 18],
    ],
    body,
  )
  p.line(6, 8, 22, 5, bodyHi)
  p.line(10, 18, 26, 14, bodyLo)

  // объектив
  p.ellipse(9, 14, 4, 4, bodyLo)
  p.ellipse(9, 14, 2, 2, glass)
  p.rect(8, 12, 1, 1, rgba('#9fd4e8'))

  // красный огонёк записи
  p.rect(22, 8, 2, 2, rgba('#d4402e'))
}

/** Вирус-тыква: оранжевая тыква с зелёными шипами и злой ухмылкой. */
function virus(p: Pix): void {
  const body = rgba('#dd7a1e')
  const bodyLo = rgba('#a8540e')
  const bodyHi = rgba('#f2a04a')
  const green = rgba('#5f9e3c')
  const greenHi = rgba('#7fbf55')
  const dark = rgba('#231106')

  // вирусные шипы с шариками
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2
    const x0 = Math.round(16 + Math.cos(a) * 10)
    const y0 = Math.round(17 + Math.sin(a) * 9)
    const x1 = Math.round(16 + Math.cos(a) * 15)
    const y1 = Math.round(17 + Math.sin(a) * 14)
    p.line(x0, y0, x1, y1, green)
    p.ellipse(x1, y1, 1, 1, greenHi)
  }

  p.ellipse(16, 17, 11, 10, body)
  p.ellipse(12, 12, 3, 2, bodyHi)
  for (const x of [11, 16, 21]) p.line(x, 9, x, 25, bodyLo)

  // черенок
  p.rect(14, 3, 4, 4, green)
  p.rect(14, 3, 4, 1, greenHi)
  p.rect(17, 2, 2, 2, green)

  // злые глаза
  p.poly(
    [
      [10, 12],
      [14, 13],
      [11, 17],
    ],
    dark,
  )
  p.poly(
    [
      [22, 12],
      [18, 13],
      [21, 17],
    ],
    dark,
  )

  // ухмылка
  const zig: Array<[number, number]> = [
    [9, 21],
    [12, 23],
    [14, 20],
    [16, 23],
    [18, 20],
    [20, 23],
    [23, 21],
  ]
  for (let i = 0; i + 1 < zig.length; i++) {
    p.line(zig[i][0], zig[i][1], zig[i + 1][0], zig[i + 1][1], dark)
  }
}

const ICONS: Record<string, (p: Pix) => void> = {
  mail,
  browser: globe,
  computer,
  trash,
  folder,
  file,
  camera,
  map,
  virus,
  image,
}

/** Фото: рамка с небом, солнцем и горами — файлы картинок. */
function image(p: Pix): void {
  const frame = rgba('#f7f5ea')
  const frameLo = rgba('#c9c5b2')
  const sky = rgba('#7fb4d8')
  const sun = rgba('#ffd75e')
  const hill = rgba('#4f7a3c')
  const hillLo = rgba('#3a5c2c')
  p.rect(4, 6, 24, 20, frame)
  p.rect(5, 7, 22, 14, sky)
  p.ellipse(21, 11, 3, 3, sun)
  p.poly(
    [
      [5, 21],
      [12, 12],
      [18, 21],
    ],
    hill,
  )
  p.poly(
    [
      [14, 21],
      [21, 14],
      [27, 21],
    ],
    hillLo,
  )
  p.rect(5, 19, 22, 2, hillLo)
  p.rect(4, 6, 24, 1, rgba('#ffffff'))
  p.rect(4, 6, 1, 20, rgba('#ffffff'))
  p.rect(27, 6, 1, 20, frameLo)
  p.rect(4, 25, 24, 1, frameLo)
}

/** Карта: сложенный лист с планом блока и красной меткой. */
function map(p: Pix): void {
  const paper = rgba('#e8e2c8')
  const fold = rgba('#cfc8ac')
  const ink = rgba('#5c6e5c')
  p.rect(4, 6, 24, 20, paper)
  p.rect(11, 6, 1, 20, fold)
  p.rect(20, 6, 1, 20, fold)
  p.rect(4, 25, 24, 1, rgba('#b8b098'))
  // план: комнаты и коридор
  p.rect(6, 9, 8, 1, ink)
  p.rect(6, 9, 1, 6, ink)
  p.rect(6, 14, 20, 1, ink)
  p.rect(24, 9, 1, 6, ink)
  p.rect(17, 16, 9, 1, ink)
  p.rect(17, 16, 1, 7, ink)
  // красная метка объекта
  p.ellipse(13, 19, 2, 2, rgba('#d4402e'))
}

const cache = new Map<string, HTMLCanvasElement>()

function iconCanvas(key: string): HTMLCanvasElement {
  const cached = cache.get(key)
  if (cached) return cached
  const p = new Pix()
  ICONS[key]?.(p)
  p.outline(INK)
  p.shadow(1, 2, rgba('#000000', 0.45))
  const c = p.canvas()
  cache.set(key, c)
  return c
}

/** Нарисовать значок с центром в (cx, cy); scale — целое увеличение 32×32. */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  key: string,
  cx: number,
  cy: number,
  scale = 2,
): void {
  const c = iconCanvas(key)
  const size = S * scale
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(c, Math.round(cx - size / 2), Math.round(cy - size / 2), size, size)
  ctx.restore()
}
