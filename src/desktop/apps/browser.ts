/**
 * «Netscape Navigator» — обозреватель в духе 1997–2000 годов.
 *
 * Хром окна повторяет четвёртую версию: строка меню, панель с кнопками и
 * «жвачкой»-вертушкой справа, поле адреса, личная панель закладок и строка
 * состояния. Страницы — типичный домашний сайт конца девяностых: Times,
 * синие ссылки, счётчик посещений и «лучше всего смотрится в 800×600».
 */
import { C, bevel, fill, inside, panel, setFont, text, wrap } from '../draw'
import type { Rect } from '../draw'
import type { App } from '../app'
import type { Sound } from '../../audio'

type Page = 'home' | 'search' | 'cams' | 'error'

type Hit = { r: Rect; fn: () => void }

const SERIF = '"Times New Roman", Times, Georgia, serif'

const URLS: Record<Page, string> = {
  home: 'http://intranet.local/',
  search: 'http://intranet.local/cgi-bin/search?q=kamery',
  cams: 'http://intranet.local/security/cams/',
  error: 'http://192.168.0.13/gate/',
}

const HOME_TEXT =
  'Узел обслуживает службу охраны комплекса. Архив записей, схемы помещений ' +
  'и служебные страницы доступны только из внутренней сети.'

const ERROR_TEXT =
  'Сервер 192.168.0.13 не отвечает. Проверьте кабель, питание роутера ' +
  'и повторите попытку. Если ошибка повторяется — сообщите администратору узла.'

const NEWS = [
  ['12.11.2000', 'Обновлён журнал событий за ноябрь'],
  ['09.11.2000', 'Блок C: плановые работы на вентиляции'],
  ['31.10.2000', 'Новый порядок сдачи смены под охрану'],
]

const RESULTS = [
  ['Журнал событий — архив записей за ноябрь', 'intranet.local/journal/'],
  ['Схема вентиляции, блок C (dwg, 340 КБ)', 'intranet.local/files/blok-c/'],
  ['Служебный доступ — требуется ключ', 'intranet.local/gate/'],
]

/** Высоты полос хрома окна. */
const CHROME = {
  menu: 17,
  toolbar: 40,
  address: 24,
  personal: 21,
  status: 20,
}

/** Строка меню Netscape. */
const MENU = ['Файл', 'Правка', 'Вид', 'Переход', 'Связь', 'Справка']

export class Browser implements App {
  title = 'Netscape Navigator'
  private page: Page = 'home'
  private hits: Hit[] = []
  private sound: Sound

  constructor(sound: Sound) {
    this.sound = sound
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    this.hits = []
    fill(ctx, r, C.face)

    let y = r.y
    this.menuBar(ctx, { x: r.x, y, w: r.w, h: CHROME.menu })
    y += CHROME.menu
    this.toolbar(ctx, { x: r.x, y, w: r.w, h: CHROME.toolbar })
    y += CHROME.toolbar
    this.addressBar(ctx, { x: r.x, y, w: r.w, h: CHROME.address })
    y += CHROME.address
    this.personalBar(ctx, { x: r.x, y, w: r.w, h: CHROME.personal })
    y += CHROME.personal

    const page: Rect = { x: r.x, y, w: r.w, h: r.y + r.h - CHROME.status - y }
    fill(ctx, page, '#ffffff')
    ctx.save()
    ctx.beginPath()
    ctx.rect(page.x, page.y, page.w, page.h)
    ctx.clip()
    if (this.page === 'home') this.drawHome(ctx, page)
    if (this.page === 'cams') this.drawCams(ctx, page)
    else if (this.page === 'search') this.drawSearch(ctx, page)
    else this.drawError(ctx, page)
    ctx.restore()

    this.statusBar(ctx, {
      x: r.x,
      y: r.y + r.h - CHROME.status,
      w: r.w,
      h: CHROME.status,
    })
  }

  private go(page: Page): void {
    this.page = page
    this.sound.click()
  }

  // ── хром окна ────────────────────────────────────────────────────

  private menuBar(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.face)
    let x = r.x + 6
    for (const label of MENU) {
      setFont(ctx, 11)
      const w = ctx.measureText(label).width
      text(ctx, label, x, r.y + r.h / 2, { size: 11 })
      this.hits.push({
        r: { x: x - 4, y: r.y, w: w + 8, h: r.h },
        fn: () => this.sound.click(),
      })
      x += w + 16
    }
    ctx.strokeStyle = C.faceLo
    ctx.beginPath()
    ctx.moveTo(r.x, r.y + r.h - 0.5)
    ctx.lineTo(r.x + r.w, r.y + r.h - 0.5)
    ctx.stroke()
  }

  private toolbar(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.face)
    const y = r.y + 4
    const h = r.h - 9
    const throbber = 36
    const right = r.x + r.w - throbber - 6

    const tools: Array<[string, string, () => void]> = [
      ['back', 'Назад', () => this.sound.click()],
      ['forward', 'Вперёд', () => this.sound.click()],
      ['home', 'Домой', () => this.go('home')],
      ['reload', 'Обновить', () => this.go(this.page)],
      ['images', 'Графика', () => this.sound.click()],
      ['print', 'Печать', () => this.sound.error()],
      ['search', 'Поиск', () => this.go('search')],
      ['stop', 'Стоп', () => this.sound.error()],
    ]

    let x = r.x + 4
    for (const [glyph, label, fn] of tools) {
      setFont(ctx, 10)
      const w = Math.round(ctx.measureText(label).width) + 26
      if (x + w > right) break
      const b: Rect = { x, y, w, h }
      this.toolButton(ctx, b, glyph, label, fn)
      x += w + 2
    }

    this.throbber(ctx, { x: r.x + r.w - throbber - 4, y: r.y + 2, w: throbber, h: throbber })

    ctx.strokeStyle = C.faceLo
    ctx.beginPath()
    ctx.moveTo(r.x, r.y + r.h - 0.5)
    ctx.lineTo(r.x + r.w, r.y + r.h - 0.5)
    ctx.stroke()
  }

  private toolButton(
    ctx: CanvasRenderingContext2D,
    b: Rect,
    glyph: string,
    label: string,
    fn: () => void,
  ): void {
    panel(ctx, b, true, 1)
    this.toolGlyph(ctx, glyph, b.x + 12, b.y + b.h / 2)
    text(ctx, label, b.x + 22, b.y + b.h / 2 + 0.5, { size: 10 })
    this.hits.push({ r: b, fn })
  }

  /** Мелкие значки панели: 12×12, как в Netscape 4. */
  private toolGlyph(ctx: CanvasRenderingContext2D, kind: string, cx: number, cy: number): void {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.lineWidth = 1.4
    ctx.strokeStyle = '#1d3a1d'
    ctx.fillStyle = '#3f7a3f'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (kind === 'back' || kind === 'forward') {
      const d = kind === 'back' ? -1 : 1
      ctx.beginPath()
      ctx.moveTo(-5 * d, 0)
      ctx.lineTo(5 * d, 0)
      ctx.moveTo(-5 * d, 0)
      ctx.lineTo(-1 * d, -4)
      ctx.moveTo(-5 * d, 0)
      ctx.lineTo(-1 * d, 4)
      ctx.stroke()
    } else if (kind === 'home') {
      ctx.beginPath()
      ctx.moveTo(-6, 0)
      ctx.lineTo(0, -6)
      ctx.lineTo(6, 0)
      ctx.closePath()
      ctx.fill()
      ctx.strokeRect(-4.5, 0, 9, 6)
    } else if (kind === 'reload') {
      ctx.beginPath()
      ctx.arc(0, 0, 5, Math.PI * 0.75, Math.PI * 0.25)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(3, -5)
      ctx.lineTo(5.5, -1)
      ctx.lineTo(1, -1)
      ctx.closePath()
      ctx.fill()
    } else if (kind === 'images') {
      ctx.strokeRect(-6, -5, 12, 10)
      ctx.beginPath()
      ctx.moveTo(-5, 4)
      ctx.lineTo(-1, -1)
      ctx.lineTo(2, 2)
      ctx.lineTo(4, 0)
      ctx.lineTo(5, 4)
      ctx.closePath()
      ctx.fill()
    } else if (kind === 'print') {
      ctx.strokeRect(-5, -2, 10, 6)
      ctx.fillRect(-4, -6, 8, 4)
      ctx.strokeRect(-3.5, 3, 7, 3)
    } else if (kind === 'search') {
      ctx.beginPath()
      ctx.arc(-1, -1, 4, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(2, 2)
      ctx.lineTo(6, 6)
      ctx.stroke()
    } else {
      ctx.strokeStyle = '#8a1c1c'
      ctx.fillStyle = '#b23a2e'
      ctx.beginPath()
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.beginPath()
      ctx.moveTo(-2.5, -2.5)
      ctx.lineTo(2.5, 2.5)
      ctx.moveTo(2.5, -2.5)
      ctx.lineTo(-2.5, 2.5)
      ctx.stroke()
    }
    ctx.restore()
  }

  /** Вертушка-«жвачка»: буква N и комета по орбите. */
  private throbber(ctx: CanvasRenderingContext2D, r: Rect): void {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    ctx.save()
    ctx.fillStyle = '#12203c'
    ctx.beginPath()
    ctx.arc(cx, cy, 15, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#7f9ac4'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.strokeStyle = '#d8b24a'
    ctx.beginPath()
    ctx.ellipse(cx, cy, 16, 6, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#f0d27a'
    ctx.beginPath()
    ctx.arc(cx + 15, cy - 2, 2, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#eef3ff'
    ctx.font = `bold 18px ${SERIF}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('N', cx, cy + 1)
    ctx.textAlign = 'left'
    ctx.restore()
  }

  private addressBar(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.face)
    text(ctx, 'Адрес:', r.x + 6, r.y + r.h / 2, { size: 11 })

    const drop: Rect = { x: r.x + r.w - 22, y: r.y + 3, w: 18, h: r.h - 7 }
    const field: Rect = { x: r.x + 48, y: r.y + 3, w: drop.x - r.x - 54, h: r.h - 7 }
    fill(ctx, field, '#ffffff')
    ctx.strokeStyle = C.lo
    ctx.strokeRect(field.x + 0.5, field.y + 0.5, field.w - 1, field.h - 1)
    text(ctx, URLS[this.page], field.x + 4, field.y + field.h / 2, { size: 11, color: C.ink })

    panel(ctx, drop, true, 1)
    ctx.fillStyle = C.text
    ctx.beginPath()
    ctx.moveTo(drop.x + 6, drop.y + 7)
    ctx.lineTo(drop.x + 12, drop.y + 7)
    ctx.lineTo(drop.x + 9, drop.y + 12)
    ctx.closePath()
    ctx.fill()
    this.hits.push({ r: drop, fn: () => this.sound.click() })
  }

  private personalBar(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.face)
    text(ctx, 'Закладки:', r.x + 6, r.y + r.h / 2, { size: 10, color: C.textDim })

    const links: Array<[string, () => void]> = [
      ['Начало', () => this.go('home')],
      ['Поиск', () => this.go('search')],
      ['Почта', () => this.sound.error()],
      ['Справка', () => this.go('error')],
    ]
    let x = r.x + 62
    for (const [label, fn] of links) {
      setFont(ctx, 10)
      const w = ctx.measureText(label).width
      text(ctx, label, x, r.y + r.h / 2, { size: 10, color: C.link })
      this.hits.push({
        r: { x: x - 3, y: r.y + 2, w: w + 6, h: r.h - 4 },
        fn: () => {
          fn()
          this.sound.click()
        },
      })
      x += w + 8
      text(ctx, '|', x - 4, r.y + r.h / 2, { size: 10, color: C.textDim })
      x += 8
    }

    ctx.strokeStyle = C.faceLo
    ctx.beginPath()
    ctx.moveTo(r.x, r.y + r.h - 0.5)
    ctx.lineTo(r.x + r.w, r.y + r.h - 0.5)
    ctx.stroke()
  }

  private statusBar(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.face)
    bevel(ctx, r, false, 1)

    const left = this.page === 'error' ? 'Документ: ошибка загрузки' : 'Документ: готово'
    text(ctx, left, r.x + 8, r.y + r.h / 2, { size: 10, color: C.textDim })

    // «замок» защищённого соединения — как в Netscape
    const lockX = r.x + r.w - 176
    const lockY = r.y + r.h / 2
    ctx.fillStyle = '#8a8a80'
    ctx.fillRect(lockX, lockY - 2, 8, 6)
    ctx.strokeStyle = '#4a4a44'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(lockX + 4, lockY - 2, 2.5, Math.PI, 0)
    ctx.stroke()

    // индикатор прогресса загрузки: три сегмента
    for (let i = 0; i < 3; i++) {
      const seg: Rect = { x: r.x + r.w - 162 + i * 18, y: r.y + 6, w: 15, h: r.h - 12 }
      panel(ctx, seg, false, 1)
      if (i === 0) fill(ctx, { x: seg.x + 2, y: seg.y + 2, w: seg.w - 4, h: seg.h - 4 }, '#3f7a3f')
    }

    text(ctx, '33.6 Кбит/с', r.x + r.w - 100, r.y + r.h / 2, { size: 10, color: C.textDim })
  }

  // ── страницы ─────────────────────────────────────────────────────

  private serif(
    ctx: CanvasRenderingContext2D,
    size: number,
    bold = false,
    align: CanvasTextAlign = 'left',
  ): void {
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${SERIF}`
    ctx.textAlign = align
    ctx.textBaseline = 'middle'
  }

  private rule(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
    ctx.strokeStyle = '#9a9a90'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y + 0.5)
    ctx.lineTo(x + w, y + 0.5)
    ctx.stroke()
    ctx.strokeStyle = '#f2f2ea'
    ctx.beginPath()
    ctx.moveTo(x, y + 1.5)
    ctx.lineTo(x + w, y + 1.5)
    ctx.stroke()
  }

  private link(
    ctx: CanvasRenderingContext2D,
    label: string,
    x: number,
    y: number,
    fn: () => void,
    size = 13,
    seen = false,
  ): void {
    this.serif(ctx, size)
    const w = ctx.measureText(label).width
    ctx.fillStyle = seen ? C.linkSeen : C.link
    ctx.fillText(label, x, y)
    ctx.strokeStyle = seen ? C.linkSeen : C.link
    ctx.beginPath()
    ctx.moveTo(x, y + size * 0.58)
    ctx.lineTo(x + w, y + size * 0.58)
    ctx.stroke()
    this.hits.push({ r: { x: x - 2, y: y - size / 2, w: w + 4, h: size + 2 }, fn })
  }

  private drawHome(ctx: CanvasRenderingContext2D, p: Rect): void {
    const cx = p.x + p.w / 2

    this.serif(ctx, 22, true, 'center')
    ctx.fillStyle = '#1a1a6b'
    ctx.fillText('ВНУТРЕННИЙ УЗЕЛ', cx, p.y + 28)
    this.serif(ctx, 11, false, 'center')
    ctx.fillStyle = '#5c5c54'
    ctx.fillText('сеть комплекса · узел INTRANET-LOCAL', cx, p.y + 46)

    this.rule(ctx, p.x + 14, p.y + 56, p.w - 28)

    const x = p.x + 20
    let y = p.y + 72
    this.serif(ctx, 13)
    ctx.fillStyle = '#23231c'
    for (const line of wrap(ctx, HOME_TEXT, p.w - 150, 13)) {
      ctx.fillText(line, x, y)
      y += 16
    }

    y += 10
    this.serif(ctx, 13, true)
    ctx.fillStyle = '#23231c'
    ctx.fillText('Новости узла:', x, y)
    y += 18
    for (const [date, label] of NEWS) {
      this.serif(ctx, 12)
      ctx.fillStyle = '#5c5c54'
      ctx.fillText(date, x, y)
      this.link(ctx, label, x + 78, y, () => this.go('error'), 12)
      y += 17
    }

    y += 8
    this.rule(ctx, p.x + 14, y, p.w - 28)
    y += 18

    this.link(ctx, '› Поиск по узлу', x, y, () => this.go('search'))
    y += 19
    this.link(ctx, '› Сеть наблюдения блока C', x, y, () => this.go('cams'))
    y += 19
    this.link(ctx, '› Список файлов блока C', x, y, () => this.go('error'))
    y += 19
    this.link(ctx, '› Почтовый шлюз (только изнутри)', x, y, () => this.sound.error())

    // счётчик посещений
    const footY = p.y + p.h - 44
    this.serif(ctx, 11)
    ctx.fillStyle = '#5c5c54'
    ctx.fillText('Вы посетитель №', x, footY)
    let dx = x + 104
    for (const d of '000137') {
      fill(ctx, { x: dx, y: footY - 8, w: 9, h: 15 }, '#23231c')
      this.serif(ctx, 11, true)
      ctx.fillStyle = '#7fe07f'
      ctx.textAlign = 'center'
      ctx.fillText(d, dx + 4.5, footY)
      ctx.textAlign = 'left'
      dx += 10
    }

    this.serif(ctx, 10)
    ctx.fillStyle = '#5c5c54'
    ctx.fillText('Лучше всего смотрится в Netscape Navigator 4.0 · 800×600 · 256 цветов', x, footY + 20)
    ctx.fillText('Страница обновлена 12.11.2000. © Служба охраны комплекса', x, footY + 34)

    // значок «страница в разработке»
    const badge: Rect = { x: p.x + p.w - 96, y: p.y + 76, w: 74, h: 34 }
    fill(ctx, badge, '#f4e27a')
    ctx.strokeStyle = '#8a7a1a'
    ctx.strokeRect(badge.x + 0.5, badge.y + 0.5, badge.w - 1, badge.h - 1)
    this.serif(ctx, 10, true)
    ctx.fillStyle = '#5a4a0a'
    ctx.textAlign = 'center'
    ctx.fillText('СТРАНИЦА', badge.x + badge.w / 2, badge.y + 12)
    ctx.fillText('В РАЗРАБОТКЕ', badge.x + badge.w / 2, badge.y + 24)
    ctx.textAlign = 'left'
  }

  private drawSearch(ctx: CanvasRenderingContext2D, p: Rect): void {
    const x = p.x + 18
    let y = p.y + 30

    this.serif(ctx, 20, true)
    ctx.fillStyle = '#1a1a6b'
    ctx.fillText('ПОИСК ПО УЗЛУ', x, y)
    y += 16
    this.rule(ctx, p.x + 14, y, p.w - 28)
    y += 24

    this.serif(ctx, 12)
    ctx.fillStyle = '#23231c'
    ctx.fillText('Искать:', x, y)
    const q: Rect = { x: x + 52, y: y - 10, w: p.w - 210, h: 22 }
    fill(ctx, q, '#ffffff')
    ctx.strokeStyle = C.lo
    ctx.strokeRect(q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1)
    text(ctx, 'камеры', q.x + 5, q.y + 11, { size: 12, color: C.ink })

    const find: Rect = { x: q.x + q.w + 8, y: q.y, w: 62, h: 22 }
    panel(ctx, find, true, 1)
    this.serif(ctx, 12)
    ctx.fillStyle = C.text
    ctx.textAlign = 'center'
    ctx.fillText('Найти', find.x + find.w / 2, find.y + find.h / 2)
    ctx.textAlign = 'left'
    this.hits.push({
      r: find,
      fn: () => {
        this.sound.click()
      },
    })

    y += 40
    this.serif(ctx, 12)
    ctx.fillStyle = '#5c5c54'
    ctx.fillText(`Найдено документов: ${RESULTS.length} · время поиска 0,31 с`, x, y)
    y += 20

    RESULTS.forEach(([title, url], i) => {
      this.link(ctx, title, x, y, () => this.go('error'), 14)
      y += 17
      this.serif(ctx, 11)
      ctx.fillStyle = '#2f6b2f'
      ctx.fillText(url, x, y)
      y += 15
      this.serif(ctx, 11)
      ctx.fillStyle = '#5c5c54'
      ctx.fillText('Индексировано 12.11.2000 · размер 12 КБ · найдено совпадений: ' + (i + 2), x, y)
      y += 22
    })

    y += 4
    this.serif(ctx, 11)
    ctx.fillStyle = '#5c5c54'
    ctx.fillText('Страница 1 из 1 · Следующая ›', x, y)
  }

  /** Служебная страница: список камер блока и правила работы с ними. */
  private drawCams(ctx: CanvasRenderingContext2D, p: Rect): void {
    const x = p.x + 20
    let y = p.y + 26

    this.serif(ctx, 16, true)
    ctx.fillStyle = '#23231c'
    ctx.fillText('Сеть наблюдения · блок C', x, y)
    y += 20
    this.serif(ctx, 11)
    ctx.fillStyle = '#5c5c54'
    ctx.fillText('узел INTRANET-LOCAL · служба безопасности · доступ: оператор', x, y)
    y += 16
    this.rule(ctx, x, y, p.w - 40)
    y += 20

    this.serif(ctx, 12)
    const cams: Array<[string, string, string]> = [
      ['КАМ-1', 'комната 4 · общий вид', 'ОНЛАЙН'],
      ['КАМ-2', 'комната 4 · дверь', 'ОНЛАЙН'],
      ['КАМ-3', 'комната 4 · нижний угол', 'ОНЛАЙН'],
      ['КАМ-4', 'архивная запись 03:06', 'ЗАПИСЬ'],
    ]
    for (const [name, place, status] of cams) {
      this.serif(ctx, 12, true)
      ctx.fillStyle = '#23231c'
      ctx.fillText(name, x, y)
      this.serif(ctx, 12)
      ctx.fillStyle = '#5c5c54'
      ctx.fillText(place, x + 64, y)
      ctx.fillStyle = status === 'ОНЛАЙН' ? '#2c7a2c' : '#8a5a12'
      ctx.fillText('· ' + status, x + 260, y)
      y += 18
    }

    y += 10
    this.rule(ctx, x, y, p.w - 40)
    y += 20

    this.serif(ctx, 12)
    ctx.fillStyle = '#23231c'
    for (const line of [
      'Картомониторинг: приложение «Карта» на столе оператора.',
      'Переключение каналов — только с карты.',
      'Управление замками: одна команда за раз, с подтверждением по почте.',
      'Напоминаем: наблюдение не означает вмешательство.',
    ]) {
      for (const part of wrap(ctx, line, p.w - 60, 12)) {
        ctx.fillText(part, x, y)
        y += 16
      }
      y += 3
    }

    y += 8
    this.link(ctx, '← На главную', x, y, () => this.go('home'))
  }

  private drawError(ctx: CanvasRenderingContext2D, p: Rect): void {
    const cx = p.x + p.w / 2
    let y = p.y + 54

    // разорванное соединение: глобус с молнией
    ctx.save()
    ctx.translate(cx, y)
    ctx.fillStyle = '#2f6cb0'
    ctx.beginPath()
    ctx.arc(0, 0, 20, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#a9cdf0'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.ellipse(0, 0, 8, 20, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-20, 0)
    ctx.lineTo(20, 0)
    ctx.stroke()
    ctx.strokeStyle = '#b23a2e'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(-13, -13)
    ctx.lineTo(13, 13)
    ctx.moveTo(13, -13)
    ctx.lineTo(-13, 13)
    ctx.stroke()
    ctx.restore()

    y += 46
    this.serif(ctx, 18, true, 'center')
    ctx.fillStyle = '#23231c'
    ctx.fillText('Не удалось подключиться к серверу', cx, y)

    y += 28
    this.serif(ctx, 12, false, 'center')
    for (const line of wrap(ctx, ERROR_TEXT, p.w - 150, 12)) {
      ctx.fillText(line, cx, y)
      y += 16
    }

    y += 22
    const retry: Rect = { x: cx - 54, y: y - 12, w: 108, h: 26 }
    panel(ctx, retry, true, 2)
    this.serif(ctx, 12, false, 'center')
    ctx.fillStyle = C.text
    ctx.fillText('Повторить', cx, retry.y + retry.h / 2)
    this.hits.push({ r: retry, fn: () => this.go('home') })

    y += 34
    this.serif(ctx, 11, false, 'center')
    ctx.fillStyle = '#5c5c54'
    ctx.fillText(URLS.error, cx, y)
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
