import { C, button, fill, inside, setFont, text, wrap } from '../draw'
import type { Rect } from '../draw'
import type { App } from '../app'
import type { Sound } from '../../audio'

type Page = 'home' | 'search' | 'error'

type Hit = { r: Rect; fn: () => void }

const URLS: Record<Page, string> = {
  home: 'http://intranet.local/',
  search: 'http://intranet.local/search.htm?q=kamery',
  error: 'http://192.168.0.13/gate/',
}

const HOME_TEXT =
  'Внутренний узел. Доступ только для сотрудников. ' +
  'Материалы, размещённые на сервере, не подлежат передаче третьим лицам.'

const ERROR_TEXT =
  'Сервер 192.168.0.13 не отвечает. Проверьте кабель, питание роутера и повторите попытку.'

const RESULTS = [
  'Журнал событий — архив записей за ноябрь',
  'Схема вентиляции, блок C (dwg, 340 КБ)',
  'Служебный доступ — требуется ключ',
]

export class Browser implements App {
  title = 'Обозреватель'
  private page: Page = 'home'
  private hits: Hit[] = []
  private sound: Sound

  constructor(sound: Sound) {
    this.sound = sound
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    this.hits = []
    fill(ctx, r, C.face)
    this.toolbar(ctx, r)
    this.bookmarks(ctx, r)

    const page: Rect = { x: r.x + 4, y: r.y + 52, w: r.w - 8, h: r.h - 56 }
    fill(ctx, page, C.paper)
    ctx.strokeStyle = C.lo
    ctx.lineWidth = 1
    ctx.strokeRect(page.x + 0.5, page.y + 0.5, page.w - 1, page.h - 1)

    ctx.save()
    ctx.beginPath()
    ctx.rect(page.x, page.y, page.w, page.h)
    ctx.clip()
    if (this.page === 'home') this.drawHome(ctx, page)
    else if (this.page === 'search') this.drawSearch(ctx, page)
    else this.drawError(ctx, page)
    ctx.restore()
  }

  private go(page: Page): void {
    this.page = page
    this.sound.click()
  }

  private toolbar(ctx: CanvasRenderingContext2D, r: Rect): void {
    const y = r.y + 5
    text(ctx, 'Адрес:', r.x + 8, y + 10, { size: 12 })

    const stop: Rect = { x: r.x + r.w - 50, y, w: 46, h: 21 }
    const refresh: Rect = { x: stop.x - 70, y, w: 66, h: 21 }
    const goBtn: Rect = { x: refresh.x - 66, y, w: 62, h: 21 }
    const field: Rect = { x: r.x + 52, y, w: goBtn.x - r.x - 58, h: 21 }

    fill(ctx, field, C.paper)
    ctx.strokeStyle = C.lo
    ctx.strokeRect(field.x + 0.5, field.y + 0.5, field.w - 1, field.h - 1)
    text(ctx, URLS[this.page], field.x + 5, field.y + 11, { size: 11, color: C.ink })

    button(ctx, goBtn, 'Перейти')
    button(ctx, refresh, 'Обновить')
    button(ctx, stop, 'Стоп', true)

    this.hits.push({ r: goBtn, fn: () => this.go(this.page === 'error' ? 'home' : this.page) })
    this.hits.push({ r: refresh, fn: () => this.go(this.page) })
    this.hits.push({
      r: stop,
      fn: () => {
        this.sound.error()
      },
    })
  }

  private bookmarks(ctx: CanvasRenderingContext2D, r: Rect): void {
    const y = r.y + 38
    const items: Array<[string, () => void]> = [
      ['Начало', () => this.go('home')],
      ['Поиск', () => this.go('search')],
      ['Почта', () => this.sound.error()],
      ['Справка', () => this.go('error')],
    ]
    let x = r.x + 8
    for (const [label, fn] of items) {
      setFont(ctx, 11)
      const w = ctx.measureText(label).width
      const box: Rect = { x: x - 3, y: y - 8, w: w + 6, h: 16 }
      text(ctx, label, x, y, { size: 11, color: C.text })
      this.hits.push({
        r: box,
        fn: () => {
          fn()
          this.sound.click()
        },
      })
      x += w + 16
    }
  }

  private link(
    ctx: CanvasRenderingContext2D,
    label: string,
    x: number,
    y: number,
    fn: () => void,
    opts: { size?: number; seen?: boolean } = {},
  ): void {
    const size = opts.size ?? 12
    setFont(ctx, size)
    const w = ctx.measureText(label).width
    text(ctx, label, x, y, { size, color: opts.seen ? C.linkSeen : C.link })
    ctx.strokeStyle = opts.seen ? C.linkSeen : C.link
    ctx.beginPath()
    ctx.moveTo(x, y + size * 0.56)
    ctx.lineTo(x + w, y + size * 0.56)
    ctx.stroke()
    this.hits.push({ r: { x: x - 2, y: y - size / 2, w: w + 4, h: size + 2 }, fn })
  }

  private drawHome(ctx: CanvasRenderingContext2D, p: Rect): void {
    const x = p.x + 18
    let y = p.y + 30
    text(ctx, 'ДОБРО ПОЖАЛОВАТЬ В СЕТЬ', x, y, { size: 20, bold: true, color: C.ink })
    y += 14
    ctx.strokeStyle = C.ink
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(p.x + p.w - 18, y)
    ctx.stroke()

    y += 22
    for (const line of wrap(ctx, HOME_TEXT, p.w - 36, 12)) {
      text(ctx, line, x, y, { size: 12, color: C.ink })
      y += 16
    }

    y += 14
    const links: Array<[string, () => void]> = [
      ['› Поиск по узлу', () => this.go('search')],
      ['› Каталог страниц', () => this.go('error')],
      ['› Почтовый шлюз', () => this.sound.error()],
      ['› Справка', () => this.go('error')],
    ]
    for (const [label, fn] of links) {
      this.link(ctx, label, x, y, fn)
      y += 21
    }

    const footY = p.y + p.h - 26
    ctx.strokeStyle = C.lo
    ctx.beginPath()
    ctx.moveTo(x, footY - 12)
    ctx.lineTo(p.x + p.w - 18, footY - 12)
    ctx.stroke()
    text(ctx, 'Соединение: 33.6 kbps · Узел: INTRANET-LOCAL · © 2000', x, footY, {
      size: 10,
      color: C.textDim,
    })
  }

  private drawSearch(ctx: CanvasRenderingContext2D, p: Rect): void {
    const x = p.x + 18
    let y = p.y + 30
    text(ctx, 'ПОИСК ПО УЗЛУ', x, y, { size: 18, bold: true, color: C.ink })

    y += 26
    const q: Rect = { x, y: y - 10, w: p.w - 160, h: 22 }
    fill(ctx, q, '#ffffff')
    ctx.strokeStyle = C.lo
    ctx.strokeRect(q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1)
    text(ctx, 'камеры', q.x + 5, q.y + 11, { size: 12, color: C.ink })

    const find: Rect = { x: q.x + q.w + 8, y: q.y, w: 70, h: 22 }
    button(ctx, find, 'Найти')
    this.hits.push({
      r: find,
      fn: () => {
        this.sound.click()
      },
    })

    y += 32
    text(ctx, `Найдено документов: ${RESULTS.length}`, x, y, { size: 11, color: C.textDim })
    y += 20
    RESULTS.forEach((label, i) => {
      text(ctx, `${i + 1}.`, x, y, { size: 12, color: C.ink })
      this.link(ctx, label, x + 18, y, () => this.go('error'))
      y += 22
    })

    y += 10
    text(ctx, 'Страница 1 из 1', x, y, { size: 11, color: C.textDim })
  }

  private drawError(ctx: CanvasRenderingContext2D, p: Rect): void {
    const cx = p.x + p.w / 2
    let y = p.y + 56

    const box: Rect = { x: cx - 22, y: y - 22, w: 44, h: 44 }
    fill(ctx, box, C.alert)
    text(ctx, '!', cx, y - 1, { size: 30, bold: true, color: '#ffffff', align: 'center' })

    y += 52
    text(ctx, 'Не удаётся отобразить страницу', cx, y, {
      size: 16,
      bold: true,
      color: C.ink,
      align: 'center',
    })

    y += 26
    const lines = wrap(ctx, ERROR_TEXT, p.w - 120, 12)
    for (const line of lines) {
      text(ctx, line, cx, y, { size: 12, color: C.ink, align: 'center' })
      y += 16
    }

    y += 18
    const retry: Rect = { x: cx - 50, y: y - 11, w: 100, h: 24 }
    button(ctx, retry, 'Повторить')
    this.hits.push({ r: retry, fn: () => this.go('home') })
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
