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
import { LockGame } from './lock-game'
import { PairsGame } from './pairs-game'

type Page =
  | 'home'
  | 'search'
  | 'cams'
  | 'journal'
  | 'files'
  | 'gate'
  | 'mail'
  | 'help'
  | 'lock'
  | 'pairs'
  | 'error'
  | 'external'
  | 'notfound'

/** Активное поле ввода: адресная строка или поиск. */
type Focus = 'address' | 'search'

type Hit = { r: Rect; fn: () => void }

const SERIF = '"Times New Roman", Times, Georgia, serif'

const URLS = {
  home: 'http://intranet.local/',
  search: 'http://intranet.local/cgi-bin/search?q=kamery',
  cams: 'http://intranet.local/security/cams/',
  journal: 'http://intranet.local/journal/',
  files: 'http://intranet.local/files/blok-c/',
  gate: 'http://intranet.local/gate/',
  mail: 'http://intranet.local/mail/',
  help: 'http://intranet.local/help/',
  lock: 'http://lockreset.local/',
  pairs: 'http://pairs.local/',
  error: 'http://192.168.0.13/gate/',
} as const

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
  private url: string = URLS.home
  private history: string[] = [URLS.home]
  private hIndex = 0
  private hits: Hit[] = []
  /** Прямоугольники полей ввода — нужны, чтобы клик по ним ставил фокус. */
  private fields: Array<{ r: Rect; kind: Focus }> = []
  private focus: Focus | null = null
  private editValue = ''
  private caret = 0
  private selectAll = false
  private loading = 0
  private t = 0
  private status = 'готово'
  private sound: Sound
  /** Мини-игра сброса замка; победа уходит рабочему столу, тот отпирает дверь. */
  private game: LockGame
  /** Головоломка-пары: печать пароля и провал уходят в рабочий стол. */
  private pairs: PairsGame
  /** Вызывается, когда мини-игра сняла блокировку двери. */
  onUnlockDoor?: () => void
  /** Головоломка-пары проиграна: на кухне просыпается маньяк. */
  onPairsFail?: () => void
  /** Нажата «Печать»: код с бумажки уходит на принтер в кухне. */
  onPrintCode?: (code: string) => void
  /** Пароль выхода показан на сайте — дверь кухни его запомнит. */
  onPassword?: (code: string) => void

  constructor(sound: Sound) {
    this.sound = sound
    this.game = new LockGame(sound)
    this.game.onWin = () => this.onUnlockDoor?.()
    this.pairs = new PairsGame(sound)
    this.pairs.onFail = () => this.onPairsFail?.()
    this.pairs.onPrint = (code) => this.onPrintCode?.(code)
    this.pairs.onPassword = (code) => this.onPassword?.(code)
    ;(window as unknown as { __browser?: Browser }).__browser = this
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    this.hits = []
    this.fields = []
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
    switch (this.page) {
      case 'home':
        this.drawHome(ctx, page)
        break
      case 'search':
        this.drawSearch(ctx, page)
        break
      case 'cams':
        this.drawCams(ctx, page)
        break
      case 'journal':
        this.drawJournal(ctx, page)
        break
      case 'files':
        this.drawFiles(ctx, page)
        break
      case 'gate':
        this.drawGate(ctx, page)
        break
      case 'mail':
        this.drawMail(ctx, page)
        break
      case 'help':
        this.drawHelp(ctx, page)
        break
      case 'lock':
        this.drawLock(ctx, page)
        break
      case 'pairs':
        this.drawPairs(ctx, page)
        break
      case 'external':
        this.drawExternal(ctx, page)
        break
      case 'notfound':
        this.drawNotFound(ctx, page)
        break
      default:
        this.drawError(ctx, page)
    }
    ctx.restore()

    this.statusBar(ctx, {
      x: r.x,
      y: r.y + r.h - CHROME.status,
      w: r.w,
      h: CHROME.status,
    })
  }

  /** Анимация загрузки страниц и тик мини-игр на страницах замка и пар. */
  tick(): boolean {
    if (this.loading > 0) {
      this.t += 0.016
      this.loading = Math.max(0, this.loading - 0.016)
      return true
    }
    if (this.page === 'lock') return this.game.tick()
    if (this.page === 'pairs') return this.pairs.tick()
    return false
  }

  // ── навигация ────────────────────────────────────────────────────

  /** Перейти по адресу и положить его в историю. */
  private navigate(raw: string): void {
    const url = this.normalize(raw)
    this.history = this.history.slice(0, this.hIndex + 1)
    this.history.push(url)
    this.hIndex = this.history.length - 1
    this.load(url)
  }

  /** Загрузить адрес без изменения истории — назад/вперёд/обновить. */
  private load(raw: string): void {
    this.url = this.normalize(raw)
    this.page = this.route(this.url)
    this.loading = 0.5
    this.t = 0
    this.status = this.statusFor(this.page)
    this.focus = null
    this.selectAll = false
    this.sound.busy()
  }

  private statusFor(page: Page): string {
    if (page === 'error') return 'ошибка загрузки'
    if (page === 'notfound') return 'документ не найден'
    if (page === 'external') return 'внешняя сеть'
    if (page === 'lock') return 'панель сброса замка'
    if (page === 'pairs') return 'архив памяти'
    return 'готово'
  }

  /** Дописать схему, если её не ввели; короткий путь — от корня узла. */
  private normalize(raw: string): string {
    let s = raw.trim()
    if (!s) return this.url
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      if (s.startsWith('/')) s = 'http://intranet.local' + s
      else if (s.includes('.') || s.includes(':')) s = 'http://' + s
      else s = `http://intranet.local/${s.replace(/^\/+/, '')}`
    }
    return s
  }

  private route(url: string): Page {
    const low = url.toLowerCase()
    if (low === 'about:help') return 'help'
    if (low.startsWith('http://lockreset.local') || low.startsWith('https://lockreset.local')) {
      return 'lock'
    }
    if (low.startsWith('http://pairs.local') || low.startsWith('https://pairs.local')) {
      return 'pairs'
    }
    if (low.startsWith('http://intranet.local') || low.startsWith('https://intranet.local')) {
      const path = low.replace(/^https?:\/\/intranet\.local/, '').split(/[?#]/)[0]
      if (path === '' || path === '/') return 'home'
      if (path.startsWith('/security/cams')) return 'cams'
      if (path.startsWith('/cgi-bin/search')) return 'search'
      if (path.startsWith('/journal')) return 'journal'
      if (path.startsWith('/files')) return 'files'
      if (path.startsWith('/gate')) return 'gate'
      if (path.startsWith('/mail')) return 'mail'
      if (path.startsWith('/help')) return 'help'
      return 'notfound'
    }
    if (low.startsWith('http://192.168.0.13') || low.startsWith('https://192.168.0.13')) {
      return 'error'
    }
    if (/^https?:\/\//.test(low)) return 'external'
    return 'notfound'
  }

  private go(page: keyof typeof URLS): void {
    this.navigate(URLS[page])
  }

  private back(): void {
    if (this.hIndex <= 0) {
      this.sound.error()
      return
    }
    this.hIndex--
    this.load(this.history[this.hIndex])
    this.sound.click()
  }

  private forward(): void {
    if (this.hIndex >= this.history.length - 1) {
      this.sound.error()
      return
    }
    this.hIndex++
    this.load(this.history[this.hIndex])
    this.sound.click()
  }

  private reload(): void {
    if (this.loading > 0) return
    this.load(this.url)
    this.sound.click()
  }

  private stop(): void {
    if (this.loading <= 0) return
    this.loading = 0
    this.status = 'остановлено'
    this.sound.click()
  }

  /** Текущий поисковый запрос из адреса страницы. */
  private get query(): string {
    const m = this.url.match(/[?&]q=([^&#]*)/)
    if (!m) return 'камеры'
    try {
      return decodeURIComponent(m[1].replace(/\+/g, ' '))
    } catch {
      return m[1]
    }
  }

  // ── ввод ─────────────────────────────────────────────────────────

  private focusField(kind: Focus): void {
    this.focus = kind
    this.editValue = kind === 'address' ? this.url : this.query
    this.caret = this.editValue.length
    this.selectAll = true
    this.sound.click()
  }

  private submit(): void {
    if (this.focus === 'search') {
      this.navigate('http://intranet.local/cgi-bin/search?q=' + encodeURIComponent(this.editValue))
      return
    }
    if (this.focus === 'address') this.navigate(this.editValue)
  }

  key(e: KeyboardEvent): boolean {
    // На игровых страницах клавиши уходят игре, если не набран адрес.
    if (!this.focus) {
      if (this.page === 'lock') return this.game.key(e)
      if (this.page === 'pairs') return this.pairs.key(e)
    }
    if (!this.focus) return false
    const value = this.editValue

    if (e.key === 'Enter') {
      this.submit()
      return true
    }
    if (e.key === 'Escape') {
      this.focus = null
      this.selectAll = false
      return true
    }
    if (e.key === 'Backspace') {
      if (this.selectAll) {
        this.editValue = ''
        this.caret = 0
        this.selectAll = false
      } else if (this.caret > 0) {
        this.editValue = value.slice(0, this.caret - 1) + value.slice(this.caret)
        this.caret--
      }
      return true
    }
    if (e.key === 'Delete') {
      if (this.selectAll) {
        this.editValue = ''
        this.caret = 0
        this.selectAll = false
      } else if (this.caret < value.length) {
        this.editValue = value.slice(0, this.caret) + value.slice(this.caret + 1)
      }
      return true
    }
    if (e.key === 'ArrowLeft') {
      this.selectAll = false
      this.caret = Math.max(0, this.caret - 1)
      return true
    }
    if (e.key === 'ArrowRight') {
      this.selectAll = false
      this.caret = Math.min(this.editValue.length, this.caret + 1)
      return true
    }
    if (e.key === 'Home') {
      this.selectAll = false
      this.caret = 0
      return true
    }
    if (e.key === 'End') {
      this.selectAll = false
      this.caret = this.editValue.length
      return true
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      this.selectAll = true
      return true
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false
    if (e.key.length !== 1) return false

    if (this.selectAll) {
      this.editValue = ''
      this.caret = 0
      this.selectAll = false
    }
    this.editValue =
      this.editValue.slice(0, this.caret) + e.key + this.editValue.slice(this.caret)
    this.caret += e.key.length
    return true
  }

  paste(text: string): boolean {
    if (!this.focus) return false
    const clean = text.replace(/[\r\n]+/g, ' ').trim()
    if (!clean) return false
    if (this.selectAll) {
      this.editValue = ''
      this.caret = 0
      this.selectAll = false
    }
    this.editValue =
      this.editValue.slice(0, this.caret) + clean + this.editValue.slice(this.caret)
    this.caret += clean.length
    return true
  }

  /** Отдать внешнюю ссылку системному браузеру: внутри игры её не показать. */
  private openExternal(): void {
    const a = document.createElement('a')
    a.href = this.url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.click()
    this.status = 'ссылка передана в системный браузер'
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
      ['back', 'Назад', () => this.back()],
      ['forward', 'Вперёд', () => this.forward()],
      ['home', 'Домой', () => this.go('home')],
      ['reload', 'Обновить', () => this.reload()],
      ['images', 'Графика', () => this.sound.click()],
      ['print', 'Печать', () => this.sound.error()],
      ['search', 'Поиск', () => this.go('search')],
      ['stop', 'Стоп', () => this.stop()],
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

    const a = this.loading > 0 ? this.t * 7 : 0
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(a)
    ctx.strokeStyle = '#d8b24a'
    ctx.beginPath()
    ctx.ellipse(0, 0, 16, 6, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#f0d27a'
    ctx.beginPath()
    ctx.arc(15, 0, 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

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
    ctx.strokeStyle = this.focus === 'address' ? '#2c4f86' : C.lo
    ctx.strokeRect(field.x + 0.5, field.y + 0.5, field.w - 1, field.h - 1)

    const value = this.focus === 'address' ? this.editValue : this.url
    setFont(ctx, 11)
    ctx.save()
    ctx.beginPath()
    ctx.rect(field.x + 2, field.y + 1, field.w - 4, field.h - 2)
    ctx.clip()
    ctx.fillStyle = C.ink
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(value, field.x + 4, field.y + field.h / 2)
    if (this.focus === 'address') {
      const caretX = field.x + 4 + ctx.measureText(value.slice(0, this.caret)).width
      ctx.fillStyle = '#111111'
      ctx.fillRect(caretX, field.y + 4, 1, field.h - 8)
    }
    ctx.restore()
    this.fields.push({ r: field, kind: 'address' })

    panel(ctx, drop, true, 1)
    ctx.fillStyle = C.text
    ctx.beginPath()
    ctx.moveTo(drop.x + 6, drop.y + 7)
    ctx.lineTo(drop.x + 12, drop.y + 7)
    ctx.lineTo(drop.x + 9, drop.y + 12)
    ctx.closePath()
    ctx.fill()
    this.hits.push({
      r: drop,
      fn: () => {
        this.focusField('address')
      },
    })
  }

  private personalBar(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.face)
    text(ctx, 'Закладки:', r.x + 6, r.y + r.h / 2, { size: 10, color: C.textDim })

    const links: Array<[string, () => void]> = [
      ['Начало', () => this.go('home')],
      ['Поиск', () => this.go('search')],
      ['Почта', () => this.go('mail')],
      ['Справка', () => this.go('help')],
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

    const left =
      this.loading > 0 ? 'Документ: загрузка…' : `Документ: ${this.status}`
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
    const filled = this.loading > 0 ? 1 + Math.floor((1 - this.loading / 0.5) * 2.99) : 1
    for (let i = 0; i < 3; i++) {
      const seg: Rect = { x: r.x + r.w - 162 + i * 18, y: r.y + 6, w: 15, h: r.h - 12 }
      panel(ctx, seg, false, 1)
      if (i < filled) fill(ctx, { x: seg.x + 2, y: seg.y + 2, w: seg.w - 4, h: seg.h - 4 }, '#3f7a3f')
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
      this.link(ctx, label, x + 78, y, () => this.go('journal'), 12)
      y += 17
    }

    y += 8
    this.rule(ctx, p.x + 14, y, p.w - 28)
    y += 18

    this.link(ctx, '› Поиск по узлу', x, y, () => this.go('search'))
    y += 19
    this.link(ctx, '› Сеть наблюдения блока C', x, y, () => this.go('cams'))
    y += 19
    this.link(ctx, '› Список файлов блока C', x, y, () => this.go('files'))
    y += 19
    this.link(ctx, '› Почтовый шлюз (только изнутри)', x, y, () => this.go('mail'))

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
    ctx.strokeStyle = this.focus === 'search' ? '#2c4f86' : C.lo
    ctx.strokeRect(q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1)
    const value = this.focus === 'search' ? this.editValue : this.query
    setFont(ctx, 12)
    ctx.save()
    ctx.beginPath()
    ctx.rect(q.x + 2, q.y + 1, q.w - 4, q.h - 2)
    ctx.clip()
    ctx.fillStyle = C.ink
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(value, q.x + 5, q.y + 11)
    if (this.focus === 'search') {
      const caretX = q.x + 5 + ctx.measureText(value.slice(0, this.caret)).width
      ctx.fillStyle = '#111111'
      ctx.fillRect(caretX, q.y + 4, 1, q.h - 8)
    }
    ctx.restore()
    this.fields.push({ r: q, kind: 'search' })

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
        if (this.focus === 'search') this.submit()
        else this.navigate('http://intranet.local/cgi-bin/search?q=' + encodeURIComponent(this.query))
      },
    })

    y += 40
    this.serif(ctx, 12)
    ctx.fillStyle = '#5c5c54'
    ctx.fillText(`Найдено документов: ${RESULTS.length} · время поиска 0,31 с`, x, y)
    y += 20

    RESULTS.forEach(([title, url], i) => {
      this.link(ctx, title, x, y, () => this.navigate('http://' + url), 14)
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

  /** Служебная страница: камеры теперь живут в отдельной программе. */
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
    y += 22

    this.serif(ctx, 13)
    ctx.fillStyle = '#23231c'
    for (const line of [
      'Просмотр камер вынесен в терминал TDS.',
      'Программу присылает служба безопасности: сохраните вложение',
      'из письма, дождитесь установки и запустите ярлык tds.exe.',
      'Карта блока и все камеры — внутри терминала.',
    ]) {
      for (const part of wrap(ctx, line, p.w - 60, 13)) {
        ctx.fillText(part, x, y)
        y += 17
      }
      y += 2
    }

    y += 10
    this.rule(ctx, x, y, p.w - 40)
    y += 20
    this.serif(ctx, 12)
    ctx.fillStyle = '#5c5c54'
    for (const line of wrap(
      ctx,
      'Веб-обозреватель картинку с камер не показывает — это ограничение узла.',
      p.w - 60,
      12,
    )) {
      ctx.fillText(line, x, y)
      y += 16
    }

    y += 12
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
    this.hits.push({ r: retry, fn: () => this.reload() })

    y += 34
    this.serif(ctx, 11, false, 'center')
    ctx.fillStyle = '#5c5c54'
    ctx.fillText(this.url, cx, y)
  }

  private drawJournal(ctx: CanvasRenderingContext2D, p: Rect): void {
    const x = p.x + 20
    let y = p.y + 26

    this.serif(ctx, 16, true)
    ctx.fillStyle = '#23231c'
    ctx.fillText('ЖУРНАЛ СОБЫТИЙ', x, y)
    y += 18
    this.serif(ctx, 11)
    ctx.fillStyle = '#5c5c54'
    ctx.fillText('узел INTRANET-LOCAL · блок C · ноябрь 2000', x, y)
    y += 16
    this.rule(ctx, x, y, p.w - 40)
    y += 20

    const rows: Array<[string, string]> = [
      ['12.11.2000 03:06', 'КАМ-04: движение в комнате 4, объект на стуле'],
      ['12.11.2000 03:07', 'Письмо без темы от неизвестного отправителя'],
      ['11.11.2000 22:40', 'Комната 4: замок закрыт изнутри, ключ не использован'],
      ['09.11.2000 08:15', 'Плановые работы: вентиляция блока C'],
      ['31.10.2000 19:00', 'Смена охраны принята без замечаний'],
    ]
    for (const [date, label] of rows) {
      this.serif(ctx, 11)
      ctx.fillStyle = '#5c5c54'
      ctx.fillText(date, x, y)
      this.serif(ctx, 12)
      ctx.fillStyle = '#23231c'
      for (const line of wrap(ctx, label, p.w - 140, 12)) {
        ctx.fillText(line, x + 104, y)
        y += 15
      }
      y += 5
    }

    y += 8
    this.rule(ctx, x, y, p.w - 40)
    y += 18
    this.link(ctx, '← На главную', x, y, () => this.go('home'))
  }

  private drawFiles(ctx: CanvasRenderingContext2D, p: Rect): void {
    const x = p.x + 20
    let y = p.y + 26

    this.serif(ctx, 16, true)
    ctx.fillStyle = '#23231c'
    ctx.fillText('ФАЙЛЫ · БЛОК C', x, y)
    y += 18
    this.serif(ctx, 11)
    ctx.fillStyle = '#5c5c54'
    ctx.fillText('каталог /files/blok-c/ · только служебный доступ', x, y)
    y += 16
    this.rule(ctx, x, y, p.w - 40)
    y += 22

    const files: Array<[string, string]> = [
      ['plan-bloka-c.gif', '84 КБ · схема помещений'],
      ['vent-blok-c.dwg', '340 КБ · вентиляция, лист 3'],
      ['cam04-archive.zip', '2,4 МБ · архив записей КАМ-04'],
      ['readme.txt', '1 КБ · служебная записка'],
    ]
    for (const [name, note] of files) {
      this.link(ctx, name, x, y, () => this.navigate('http://intranet.local/gate/'), 13)
      this.serif(ctx, 11)
      ctx.fillStyle = '#5c5c54'
      ctx.fillText(note, x + 190, y)
      y += 22
    }

    y += 8
    this.serif(ctx, 11)
    ctx.fillStyle = '#5c5c54'
    ctx.fillText('Скачивание файлов заблокировано политикой узла.', x, y)
    y += 22
    this.link(ctx, '← На главную', x, y, () => this.go('home'))
  }

  private drawGate(ctx: CanvasRenderingContext2D, p: Rect): void {
    const x = p.x + 20
    let y = p.y + 26

    this.serif(ctx, 16, true)
    ctx.fillStyle = '#23231c'
    ctx.fillText('СЛУЖЕБНЫЙ ДОСТУП', x, y)
    y += 20
    this.rule(ctx, x, y, p.w - 40)
    y += 24

    this.serif(ctx, 13)
    ctx.fillStyle = '#23231c'
    for (const line of wrap(
      ctx,
      'Для доступа к архиву записей нужен ключ службы безопасности. Ключ выдаётся только оператору на смене.',
      p.w - 60,
      13,
    )) {
      ctx.fillText(line, x, y)
      y += 17
    }

    y += 16
    const btn: Rect = { x, y: y - 12, w: 190, h: 26 }
    panel(ctx, btn, true, 2)
    this.serif(ctx, 12, false, 'center')
    ctx.fillStyle = C.text
    ctx.fillText('Запросить ключ', btn.x + btn.w / 2, btn.y + btn.h / 2)
    this.hits.push({
      r: btn,
      fn: () => {
        this.status = 'запрос отправлен службе безопасности'
        this.sound.message()
      },
    })

    y += 38
    this.serif(ctx, 11)
    ctx.fillStyle = '#5c5c54'
    ctx.fillText('Ответ придёт на рабочую почту.', x, y)
    y += 28
    this.link(ctx, '← На главную', x, y, () => this.go('home'))
  }

  private drawMail(ctx: CanvasRenderingContext2D, p: Rect): void {
    const x = p.x + 20
    let y = p.y + 26

    this.serif(ctx, 16, true)
    ctx.fillStyle = '#23231c'
    ctx.fillText('ПОЧТОВЫЙ ШЛЮЗ', x, y)
    y += 20
    this.rule(ctx, x, y, p.w - 40)
    y += 24

    this.serif(ctx, 13)
    ctx.fillStyle = '#23231c'
    for (const line of wrap(
      ctx,
      'Веб-почта доступна только с рабочей станции оператора. Откройте приложение «Почта» на рабочем столе.',
      p.w - 60,
      13,
    )) {
      ctx.fillText(line, x, y)
      y += 17
    }

    y += 18
    this.serif(ctx, 11)
    ctx.fillStyle = '#5c5c54'
    ctx.fillText('Сеанс: локальный · шифрование: выключено', x, y)
    y += 28
    this.link(ctx, '← На главную', x, y, () => this.go('home'))
  }

  /** Страница lockreset.local: тёмная панель сброса замка с мини-игрой. */
  private drawLock(ctx: CanvasRenderingContext2D, p: Rect): void {
    fill(ctx, p, '#050d08')

    const head = 26
    fill(ctx, { x: p.x, y: p.y, w: p.w, h: head }, '#08140c')
    ctx.strokeStyle = 'rgba(126, 154, 132, 0.35)'
    ctx.beginPath()
    ctx.moveTo(p.x, p.y + head - 0.5)
    ctx.lineTo(p.x + p.w, p.y + head - 0.5)
    ctx.stroke()
    setFont(ctx, 11, true)
    ctx.fillStyle = '#9fd39f'
    ctx.textBaseline = 'middle'
    ctx.fillText('ПАНЕЛЬ СБРОСА БЛОКИРОВКИ · lockreset.local', p.x + 12, p.y + head / 2 + 1)

    if (this.loading > 0) {
      text(ctx, 'соединение…', p.x + p.w / 2, p.y + head + (p.h - head) / 2, {
        size: 12,
        color: '#5f6f62',
        align: 'center',
      })
      return
    }
    this.game.draw(ctx, { x: p.x, y: p.y + head, w: p.w, h: p.h - head })
  }

  /** Страница pairs.local: головоломка-пары и печать пароля. */
  private drawPairs(ctx: CanvasRenderingContext2D, p: Rect): void {
    fill(ctx, p, '#050d08')

    const head = 26
    fill(ctx, { x: p.x, y: p.y, w: p.w, h: head }, '#08140c')
    ctx.strokeStyle = 'rgba(126, 154, 132, 0.35)'
    ctx.beginPath()
    ctx.moveTo(p.x, p.y + head - 0.5)
    ctx.lineTo(p.x + p.w, p.y + head - 0.5)
    ctx.stroke()
    setFont(ctx, 11, true)
    ctx.fillStyle = '#9fd39f'
    ctx.textBaseline = 'middle'
    ctx.fillText('АРХИВ ПАМЯТИ · pairs.local', p.x + 12, p.y + head / 2 + 1)

    if (this.loading > 0) {
      text(ctx, 'соединение…', p.x + p.w / 2, p.y + head + (p.h - head) / 2, {
        size: 12,
        color: '#5f6f62',
        align: 'center',
      })
      return
    }
    this.pairs.draw(ctx, { x: p.x, y: p.y + head, w: p.w, h: p.h - head })
  }

  private drawHelp(ctx: CanvasRenderingContext2D, p: Rect): void {
    const x = p.x + 20
    let y = p.y + 26

    this.serif(ctx, 16, true)
    ctx.fillStyle = '#23231c'
    ctx.fillText('СПРАВКА NETSCAPE NAVIGATOR 4.0', x, y)
    y += 20
    this.rule(ctx, x, y, p.w - 40)
    y += 22

    const tips = [
      'Адресная строка принимает обычные адреса вида intranet.local/help',
      'Enter — перейти, Esc — снять фокус, Ctrl+V — вставить ссылку.',
      'Кнопки «Назад» и «Вперёд» ходят по истории переходов.',
      'Картинку с камер показывает только программа TDS (tds.exe).',
      'Служебные страницы узла доступны без пароля.',
    ]
    for (const tip of tips) {
      this.serif(ctx, 12)
      ctx.fillStyle = '#23231c'
      for (const line of wrap(ctx, '• ' + tip, p.w - 60, 12)) {
        ctx.fillText(line, x, y)
        y += 16
      }
      y += 3
    }

    y += 8
    this.rule(ctx, x, y, p.w - 40)
    y += 18
    this.serif(ctx, 12, true)
    ctx.fillStyle = '#23231c'
    ctx.fillText('ТЕРМИНАЛ НАБЛЮДЕНИЯ', x, y)
    y += 18
    this.serif(ctx, 11)
    ctx.fillStyle = '#5c5c54'
    for (const line of wrap(
      ctx,
      'Устанавливается из письма службы безопасности. Ярлык tds.exe появится на рабочем столе.',
      p.w - 60,
      11,
    )) {
      ctx.fillText(line, x, y)
      y += 15
    }

    y += 18
    this.link(ctx, '← На главную', x, y, () => this.go('home'))
  }

  private drawExternal(ctx: CanvasRenderingContext2D, p: Rect): void {
    const cx = p.x + p.w / 2
    let y = p.y + 42

    this.serif(ctx, 18, true, 'center')
    ctx.fillStyle = '#1a1a6b'
    ctx.fillText('ВНЕШНЯЯ СЕТЬ', cx, y)
    y += 34

    this.serif(ctx, 12, false, 'center')
    ctx.fillStyle = '#23231c'
    for (const line of wrap(
      ctx,
      'Служебный сегмент не имеет выхода в интернет. Внутренний обозреватель не умеет показывать современные сайты.',
      p.w - 120,
      12,
    )) {
      ctx.fillText(line, cx, y)
      y += 16
    }

    y += 12
    this.serif(ctx, 11, false, 'center')
    ctx.fillStyle = '#2f6b2f'
    ctx.fillText(this.url, cx, y)

    y += 34
    const btn: Rect = { x: cx - 120, y: y - 14, w: 240, h: 28 }
    panel(ctx, btn, true, 2)
    this.serif(ctx, 12, false, 'center')
    ctx.fillStyle = C.text
    ctx.fillText('Открыть в системном браузере', cx, btn.y + btn.h / 2)
    this.hits.push({ r: btn, fn: () => this.openExternal() })

    y += 44
    this.serif(ctx, 11, false, 'center')
    ctx.fillStyle = '#5c5c54'
    ctx.fillText('Ссылка откроется вне игры, в обычном браузере.', cx, y)

    y += 30
    this.link(ctx, '← На главную', p.x + 20, y, () => this.go('home'))
  }

  private drawNotFound(ctx: CanvasRenderingContext2D, p: Rect): void {
    const x = p.x + 20
    let y = p.y + 32

    this.serif(ctx, 20, true)
    ctx.fillStyle = '#8a1c1c'
    ctx.fillText('404 · ДОКУМЕНТ НЕ НАЙДЕН', x, y)
    y += 24
    this.rule(ctx, x, y, p.w - 40)
    y += 24

    this.serif(ctx, 13)
    ctx.fillStyle = '#23231c'
    ctx.fillText('На узле нет страницы по адресу:', x, y)
    y += 20
    this.serif(ctx, 11)
    ctx.fillStyle = '#2f6b2f'
    ctx.fillText(this.url, x, y)
    y += 28
    this.serif(ctx, 12)
    ctx.fillStyle = '#5c5c54'
    for (const line of wrap(
      ctx,
      'Проверьте адрес или вернитесь на главную страницу узла.',
      p.w - 60,
      12,
    )) {
      ctx.fillText(line, x, y)
      y += 16
    }

    y += 16
    this.link(ctx, '← На главную', x, y, () => this.go('home'))
  }

  click(x: number, y: number, _r: Rect): void {
    // Клик по полю ввода ставит в него фокус и выделяет строку целиком.
    const field = this.fields.find((f) => inside(f.r, x, y))
    if (field) {
      this.focusField(field.kind)
      return
    }
    this.focus = null
    this.selectAll = false
    if (this.page === 'lock' && this.game.click(x, y)) return
    if (this.page === 'pairs' && this.pairs.click(x, y)) return
    for (let i = this.hits.length - 1; i >= 0; i--) {
      if (inside(this.hits[i].r, x, y)) {
        this.hits[i].fn()
        return
      }
    }
  }
}
